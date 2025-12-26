import { useState, useRef } from "react";
import { X, Upload, Image as ImageIcon, Loader2, Sparkles } from "lucide-react";
import {
  addItem,
  uploadItemImage,
  type ItemInput,
} from "../../services/itemService";
import {
  analyzeItemImage,
  getAvailableProviders,
  type AIProvider,
} from "../../services/aiService";
import { LocationPicker } from "../ui/LocationPicker";

interface AddItemModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function AddItemModal({ onClose, onSuccess }: AddItemModalProps) {
  const [step, setStep] = useState<"upload" | "analyzing" | "review">("upload");
  const [loading, setLoading] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [aiProvider, setAiProvider] = useState<AIProvider>("gemini");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableProviders = getAvailableProviders();

  const [formData, setFormData] = useState<Omit<ItemInput, "imageUrl">>({
    name: "",
    description: "",
    type: "Found",
    location: "",
    date: new Date(),
    status: "Pending",
    tags: [],
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setImageFiles(files);

      // Generate previews
      const newPreviews: string[] = [];
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          newPreviews.push(reader.result as string);
          if (newPreviews.length === files.length) {
            setImagePreviews([...newPreviews]);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleAnalyze = async () => {
    if (imageFiles.length === 0) {
      alert("Please upload an image first");
      return;
    }

    if (!formData.location) {
      alert("Please enter a location");
      return;
    }

    try {
      setStep("analyzing");
      setLoading(true);

      // Analyze image with AI (Use first image)
      const analysis = await analyzeItemImage(imageFiles[0], aiProvider);

      // Update form with AI results
      setFormData((prev) => ({
        ...prev,
        name: analysis.name,
        description: analysis.description,
        tags: analysis.tags,
      }));

      setStep("review");
    } catch (err) {
      console.error("Error analyzing image:", err);
      alert(
        `Analysis failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.location) {
      alert("Please fill in required fields");
      return;
    }

    try {
      setLoading(true);

      let uploadedImages: string[] = [];
      if (imageFiles.length > 0) {
        // Upload all images
        uploadedImages = await Promise.all(
          imageFiles.map((file) => uploadItemImage(file))
        );
      }

      await addItem({
        ...formData,
        imageUrl: uploadedImages[0], // Keep primary image for backward compatibility
        images: uploadedImages, // Store all images
      });

      onSuccess();
      onClose();
    } catch (err) {
      console.error("Error adding item:", err);
      alert(
        `Failed to publish item: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTagRemove = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags?.filter((tag) => tag !== tagToRemove),
    }));
  };

  const handleTagAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const newTag = input.value.trim();
      if (newTag && !formData.tags?.includes(newTag)) {
        setFormData((prev) => ({
          ...prev,
          tags: [...(prev.tags || []), newTag],
        }));
        input.value = "";
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-medium text-text-primary">
            {step === "upload" && "Add New Item"}
            {step === "analyzing" && "Analyzing Image..."}
            {step === "review" && "Review Item Details"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={loading}
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="p-6 flex-1 overflow-y-auto">
          {/* Step 1: Upload */}
          {step === "upload" && (
            <>
              {/* Image Upload */}
              <div className="mb-6">
                <label className="text-sm text-text-secondary mb-2 block">
                  Item Image <span className="text-google-red">*</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-64 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-blue-50 transition-all overflow-hidden relative"
                >
                  {imagePreviews.length > 0 ? (
                    imagePreviews.length === 1 ? (
                      <img
                        src={imagePreviews[0]}
                        alt="Preview"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full p-2 grid grid-cols-2 gap-2 overflow-y-auto">
                        {imagePreviews.map((preview, idx) => (
                          <img
                            key={idx}
                            src={preview}
                            alt={`Preview ${idx}`}
                            className="w-full h-32 object-cover rounded-lg"
                          />
                        ))}
                      </div>
                    )
                  ) : (
                    <>
                      <ImageIcon className="w-12 h-12 text-text-secondary mb-2" />
                      <p className="text-sm text-text-secondary">
                        Click to upload image
                      </p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">
                    Type
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        type: e.target.value as "Lost" | "Found",
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Found">Found</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">
                    Date
                  </label>
                  <input
                    type="date"
                    value={formData.date.toISOString().split("T")[0]}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        date: new Date(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Location */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block">
                  Location <span className="text-google-red">*</span>
                </label>
                <LocationPicker
                  value={formData.location}
                  onChange={(location) =>
                    setFormData({ ...formData, location })
                  }
                  placeholder="Search for a location..."
                />
              </div>

              {/* AI Provider Selection */}
              {availableProviders.length > 0 && (
                <div className="mb-6">
                  <label className="text-sm text-text-secondary mb-2 block">
                    AI Provider
                  </label>
                  <div className="flex gap-2">
                    {availableProviders.includes("gemini") && (
                      <button
                        type="button"
                        onClick={() => setAiProvider("gemini")}
                        className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
                          aiProvider === "gemini"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-gray-50"
                        }`}
                      >
                        🌟 Gemini
                      </button>
                    )}
                    {availableProviders.includes("groq") && (
                      <button
                        type="button"
                        onClick={() => setAiProvider("groq")}
                        className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
                          aiProvider === "groq"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-gray-50"
                        }`}
                      >
                        ⚡ Groq
                      </button>
                    )}
                  </div>
                </div>
              )}

              {availableProviders.length === 0 && (
                <p className="text-sm text-google-red mt-2 text-center">
                  No AI providers configured. Add API keys to .env file.
                </p>
              )}

              {/* Generate Button - Google Theme */}
              <button
                onClick={handleAnalyze}
                disabled={imageFiles.length === 0}
                className="w-full mt-6 py-4 bg-[#4285F4] text-white rounded-xl font-semibold text-lg hover:bg-[#3367D6] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                <Sparkles className="w-5 h-5" />
                Generate
              </button>
            </>
          )}

          {/* Step 2: Analyzing */}
          {step === "analyzing" && (
            <div className="py-12 text-center">
              <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-medium text-text-primary mb-2">
                Analyzing Image...
              </h3>
              <p className="text-text-secondary">
                AI is identifying the item and extracting details
              </p>
            </div>
          )}

          {/* Step 3: Review */}
          {step === "review" && (
            <>
              {/* Image Preview */}
              {/* Image Preview */}
              {imagePreviews.length > 0 && (
                <div className="mb-6">
                  <img
                    src={imagePreviews[0]}
                    alt="Item"
                    className="w-full h-48 object-cover rounded-xl"
                  />
                </div>
              )}

              {/* AI Generated Name */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block">
                  Item Name (AI Generated)
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* AI Generated Description */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-1 block">
                  Description (AI Generated)
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {/* Tags */}
              <div className="mb-4">
                <label className="text-sm text-text-secondary mb-2 block">
                  Tags (AI Generated)
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                    >
                      {tag}
                      <button
                        onClick={() => handleTagRemove(tag)}
                        className="hover:text-google-red"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Add more tags (press Enter)"
                  onKeyDown={handleTagAdd}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>

              {/* Type & Status */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">
                    Type
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        type: e.target.value as "Lost" | "Found",
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Found">Found</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        status: e.target.value as
                          | "Pending"
                          | "Matched"
                          | "Claimed",
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Matched">Matched</option>
                    <option value="Claimed">Claimed</option>
                  </select>
                </div>
              </div>

              {/* Location & Date (readonly) */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">
                    Location
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-text-primary">
                    {formData.location}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1 block">
                    Date
                  </label>
                  <p className="px-3 py-2 bg-gray-50 rounded-lg text-text-primary">
                    {formData.date.toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Actions - Blue with white text */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setStep("upload")}
                  className="flex-1 py-3 border border-gray-300 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      Publish
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
