import { useState, useEffect, useRef } from "react";
import {
  X,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Upload,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  type Item,
  type ItemInput,
  updateItemViaApi,
  uploadItemImage,
} from "../../services/itemService";
import { Timestamp } from "firebase/firestore";

interface EditReportModalProps {
  item: Item;
  onClose: () => void;
  onUpdate: () => void;
}

export function EditReportModal({
  item,
  onClose,
  onUpdate,
}: EditReportModalProps) {
  const [loading, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to parse date from various formats
  const parseDateToString = (date: unknown): string => {
    try {
      if (!date) return new Date().toISOString().split("T")[0];

      // Handle Firestore Timestamp instance
      if (date instanceof Timestamp) {
        return date.toDate().toISOString().split("T")[0];
      }

      // Handle serialized Timestamp from API (has seconds or _seconds)
      if (typeof date === "object" && date !== null) {
        const dateObj = date as { seconds?: number; _seconds?: number };
        if (dateObj.seconds !== undefined || dateObj._seconds !== undefined) {
          const seconds = dateObj.seconds ?? dateObj._seconds ?? 0;
          return new Date(seconds * 1000).toISOString().split("T")[0];
        }
      }

      // Handle Date object
      if (date instanceof Date) {
        return date.toISOString().split("T")[0];
      }

      // Handle ISO string
      if (typeof date === "string") {
        return new Date(date).toISOString().split("T")[0];
      }

      // Fallback
      return new Date().toISOString().split("T")[0];
    } catch {
      return new Date().toISOString().split("T")[0];
    }
  };

  // Form state
  const [formData, setFormData] = useState({
    name: item.name || "",
    description: item.description || "",
    location: item.location || "",
    date: parseDateToString(item.date),
    tags: item.tags || [],
  });

  // Image state - existing images from item
  const [existingImages, setExistingImages] = useState<string[]>(() => {
    const images: string[] = [];
    if (item.cloudinaryUrls && item.cloudinaryUrls.length > 0) {
      images.push(...item.cloudinaryUrls);
    }
    if (item.imageUrl) {
      images.push(item.imageUrl);
    }
    return images;
  });

  // New images to upload (base64)
  const [newImages, setNewImages] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Close on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose, loading]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Enforce max 5 images total
    const totalImages = existingImages.length + newImages.length;
    const maxNewImages = 5 - totalImages;

    if (maxNewImages <= 0) {
      setToast({
        type: "error",
        message: "Maximum 5 images allowed. Please remove some images first.",
      });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    try {
      const filesToUpload = Array.from(files).slice(0, maxNewImages);
      const uploadPromises = filesToUpload.map((file) => uploadItemImage(file));
      const base64Images = await Promise.all(uploadPromises);
      setNewImages((prev) => [...prev, ...base64Images]);
    } catch (error) {
      console.error("Error uploading images:", error);
      setToast({
        type: "error",
        message: "Failed to process images. Please try again.",
      });
      setTimeout(() => setToast(null), 3000);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeExistingImage = (index: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeNewImage = (index: number) => {
    setNewImages((prev) => prev.filter((_, i) => i !== index));
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !formData.tags.includes(tag)) {
      setFormData((prev) => ({ ...prev, tags: [...prev.tags, tag] }));
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setToast({ type: "error", message: "Item name is required." });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    try {
      setSaving(true);

      const updates: Partial<ItemInput> = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        location: formData.location.trim(),
        date: new Date(formData.date),
        tags: formData.tags,
      };

      // If images were removed, update cloudinaryUrls
      if (
        existingImages.length !==
        (item.cloudinaryUrls?.length || 0) + (item.imageUrl ? 1 : 0)
      ) {
        // Images were removed - need to update cloudinaryUrls
        (updates as Record<string, unknown>).cloudinaryUrls = existingImages;
      }

      await updateItemViaApi(
        item.id,
        updates,
        newImages.length > 0 ? newImages : undefined
      );

      setToast({ type: "success", message: "Report updated successfully!" });
      setTimeout(() => {
        setToast(null);
        onUpdate();
        onClose();
      }, 1500);
    } catch (error) {
      console.error("Error updating report:", error);
      setToast({
        type: "error",
        message: "Failed to update report. Please try again.",
      });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
      />
      <div className="relative bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Edit Report</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] space-y-5">
          {/* Toast */}
          {toast && (
            <div
              className={cn(
                "p-3 rounded-lg flex items-center gap-2 text-sm",
                toast.type === "success"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              )}
            >
              {toast.type === "success" ? (
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              {toast.message}
            </div>
          )}

          {/* Images Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Images
            </label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {/* Existing Images */}
              {existingImages.map((img, idx) => (
                <div key={`existing-${idx}`} className="relative aspect-square">
                  <img
                    src={img}
                    alt={`Image ${idx + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <button
                    onClick={() => removeExistingImage(idx)}
                    className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {/* New Images */}
              {newImages.map((img, idx) => (
                <div key={`new-${idx}`} className="relative aspect-square">
                  <img
                    src={img}
                    alt={`New Image ${idx + 1}`}
                    className="w-full h-full object-cover rounded-lg border-2 border-green-400"
                  />
                  <button
                    onClick={() => removeNewImage(idx)}
                    className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {/* Add Image Button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 hover:border-gray-400 hover:bg-gray-50 transition-colors"
              >
                <Upload className="w-5 h-5 text-gray-400" />
                <span className="text-xs text-gray-500">Add</span>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Item Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Blue Wallet"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Describe the item in detail..."
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, location: e.target.value }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Where was it lost/found?"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date
            </label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, date: e.target.value }))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {formData.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="text-gray-500 hover:text-red-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.preventDefault(), addTag())
                }
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                placeholder="Add a tag..."
              />
              <button
                onClick={addTag}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
