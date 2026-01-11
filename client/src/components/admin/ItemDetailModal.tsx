import { useState, useEffect } from "react";
import {
  X,
  Edit2,
  Trash2,
  Save,
  XCircle,
  CheckCircle,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  type Item,
  type ItemInput,
  updateItemViaApi,
  deleteItemViaApi,
  getItemById,
} from "../../services/itemService";
import { Timestamp } from "firebase/firestore";

interface ItemDetailModalProps {
  item: Item;
  onClose: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}

export function ItemDetailModal({
  item,
  onClose,
  onUpdate,
  onDelete,
}: ItemDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [matchedItem, setMatchedItem] = useState<Item | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [formData, setFormData] = useState<ItemInput>({
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    type: item.type,
    location: item.location,
    date:
      item.date instanceof Timestamp ? item.date.toDate() : new Date(item.date),
    status: item.status,
    matchScore: item.matchScore,
    tags: item.tags || [],
  });

  // Close on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  // Fetch matched item details
  useEffect(() => {
    async function fetchMatchedItem() {
      if (item.matchedItemId) {
        try {
          const matched = await getItemById(item.matchedItemId);
          setMatchedItem(matched);
        } catch (err) {
          console.error("Error fetching matched item:", err);
        }
      } else {
        setMatchedItem(null);
      }
    }
    fetchMatchedItem();
  }, [item.matchedItemId]);

  const handleSave = async () => {
    try {
      setLoading(true);
      await updateItemViaApi(item.id, formData);
      setToast({ type: "success", message: "Item updated successfully!" });
      setIsEditing(false);
      setTimeout(() => {
        setToast(null);
        onUpdate();
      }, 1500);
    } catch (err) {
      console.error("Error updating item:", err);
      setToast({
        type: "error",
        message: "Failed to update item. Please try again.",
      });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this item?")) return;

    try {
      setLoading(true);
      await deleteItemViaApi(item.id);
      setToast({ type: "success", message: "Item deleted successfully!" });
      setTimeout(() => {
        onDelete();
        onClose();
      }, 1000);
    } catch (err) {
      console.error("Error deleting item:", err);
      setToast({
        type: "error",
        message: "Failed to delete item. Please try again.",
      });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Timestamp | Date) => {
    const d = date instanceof Timestamp ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Get all available images from item
  const getItemImages = (): string[] => {
    const images: string[] = [];
    if (item.cloudinaryUrls && item.cloudinaryUrls.length > 0) {
      images.push(...item.cloudinaryUrls);
    }
    if (item.imageUrl) {
      images.push(item.imageUrl);
    }
    if (item.images && item.images.length > 0) {
      images.push(...item.images);
    }
    return images;
  };

  const itemImages = getItemImages();

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-medium text-text-primary">
            {isEditing ? "Edit Item" : "Item Details"}
          </h2>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                  title="Edit"
                >
                  <Edit2 className="w-5 h-5 text-text-secondary" />
                </button>
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-5 h-5 text-google-red" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors text-sm"
                >
                  <Save className="w-4 h-4" />
                  {loading ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                  title="Cancel"
                >
                  <XCircle className="w-5 h-5 text-text-secondary" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5 text-text-secondary" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* Toast Notification */}
          {toast && (
            <div
              className={cn(
                "mb-4 p-3 rounded-lg flex items-center gap-2 text-sm",
                toast.type === "success"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              )}
            >
              {toast.type === "success" ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
              {toast.message}
            </div>
          )}

          {/* Images */}
          <div className="mb-6 space-y-4">
            {itemImages.length > 0 ? (
              itemImages.map((img, idx) => (
                <img
                  key={idx}
                  src={img}
                  alt={`${item.name} ${idx + 1}`}
                  className="w-full h-auto max-h-[60vh] object-contain rounded-xl bg-gray-50 border border-border"
                />
              ))
            ) : (
              <div className="w-full h-64 bg-gray-100 rounded-xl flex items-center justify-center">
                <span className="text-4xl">📦</span>
              </div>
            )}
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div className="col-span-2">
              <label className="text-sm text-text-secondary mb-1 block">
                Item Name
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ) : (
                <p className="text-text-primary font-medium">{item.name}</p>
              )}
            </div>

            {/* Description */}
            <div className="col-span-2">
              <label className="text-sm text-text-secondary mb-1 block">
                Description
              </label>
              {isEditing ? (
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              ) : (
                <p className="text-text-primary">{item.description}</p>
              )}
            </div>

            {/* Type */}
            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Type
              </label>
              {isEditing ? (
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
                  <option value="Lost">Lost</option>
                  <option value="Found">Found</option>
                </select>
              ) : (
                <span
                  className={cn(
                    "inline-block px-3 py-1 rounded-full text-sm font-medium",
                    item.type === "Lost"
                      ? "bg-google-red/10 text-google-red"
                      : "bg-google-green/10 text-google-green"
                  )}
                >
                  {item.type}
                </span>
              )}
            </div>

            {/* Status */}
            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Status
              </label>
              {isEditing ? (
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      status: e.target.value as
                        | "Pending"
                        | "Matched"
                        | "Claimed"
                        | "Resolved",
                    })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="Pending">Pending</option>
                  <option value="Matched">Matched</option>
                  <option value="Claimed">Claimed</option>
                  <option value="Resolved">Resolved</option>
                </select>
              ) : (
                <span
                  className={cn(
                    "badge",
                    item.status === "Matched" && "badge-matched",
                    item.status === "Pending" && "badge-pending",
                    item.status === "Claimed" && "badge-claimed"
                  )}
                >
                  {item.status}
                </span>
              )}
            </div>

            {/* Location */}
            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Location
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) =>
                    setFormData({ ...formData, location: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ) : (
                <p className="text-text-primary">{item.location}</p>
              )}
            </div>

            {/* Date */}
            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Date
              </label>
              {isEditing ? (
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
              ) : (
                <p className="text-text-primary">{formatDate(item.date)}</p>
              )}
            </div>

            {/* Tags */}
            {(item.tags?.length || isEditing) && (
              <div className="col-span-2">
                <label className="text-sm text-text-secondary mb-2 block">
                  Tags
                </label>
                {isEditing ? (
                  <div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {formData.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                        >
                          {tag}
                          <button
                            onClick={() =>
                              setFormData({
                                ...formData,
                                tags: formData.tags?.filter((t) => t !== tag),
                              })
                            }
                            className="hover:text-google-red"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <input
                      type="text"
                      placeholder="Add tag (press Enter)"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const input = e.target as HTMLInputElement;
                          const newTag = input.value.trim();
                          if (newTag && !formData.tags?.includes(newTag)) {
                            setFormData({
                              ...formData,
                              tags: [...(formData.tags || []), newTag],
                            });
                            input.value = "";
                          }
                        }
                      }}
                      className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    />
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {item.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 bg-gray-100 rounded-full text-sm text-text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Match Score */}
            {(item.matchScore !== undefined || isEditing) && (
              <div className="col-span-2">
                <label className="text-sm text-text-secondary mb-1 block">
                  Match Score
                </label>
                {isEditing ? (
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.matchScore || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        matchScore: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="0-100"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          (item.matchScore || 0) >= 90
                            ? "bg-google-green"
                            : "bg-google-blue"
                        )}
                        style={{ width: `${item.matchScore}%` }}
                      />
                    </div>
                    <span className="text-text-primary font-medium">
                      {item.matchScore}%
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Matched Item Info */}
            {matchedItem && !isEditing && (
              <div className="col-span-2 mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex items-center gap-2 text-blue-700 mb-3">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-semibold">Matched With</span>
                </div>
                <div className="flex items-center gap-4 bg-white p-3 rounded-lg border border-blue-50">
                  {matchedItem.imageUrl || matchedItem.cloudinaryUrls?.[0] ? (
                    <img
                      src={matchedItem.imageUrl || matchedItem.cloudinaryUrls?.[0]}
                      alt={matchedItem.name}
                      className="w-16 h-16 rounded-lg object-cover border border-gray-100"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-2xl">
                      📦
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-text-primary truncate">
                      {matchedItem.name}
                    </p>
                    <p className="text-xs text-text-secondary truncate mt-0.5">
                      {matchedItem.location}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={cn(
                        "text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded",
                        matchedItem.type === "Lost" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                      )}>
                        {matchedItem.type}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      // Logic to switch view to matched item could go here
                      // For now we just show the info
                    }}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                    title="View Matched Item"
                  >
                    <ExternalLink className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
