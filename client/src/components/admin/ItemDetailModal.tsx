import { useState, useEffect } from "react";
import { X, Edit2, Trash2, Save, XCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  type Item,
  type ItemInput,
  updateItem,
  deleteItem,
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

  const handleSave = async () => {
    try {
      setLoading(true);
      await updateItem(item.id, formData);
      setIsEditing(false);
      onUpdate();
    } catch (err) {
      console.error("Error updating item:", err);
      alert("Failed to update item");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this item?")) return;

    try {
      setLoading(true);
      await deleteItem(item.id, item.imageUrl);
      onDelete();
      onClose();
    } catch (err) {
      console.error("Error deleting item:", err);
      alert("Failed to delete item");
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
          {/* Image */}
          {/* Images */}
          <div className="mb-6 space-y-4">
            {(item.images && item.images.length > 0
              ? item.images
              : item.imageUrl
              ? [item.imageUrl]
              : []
            ).length > 0 ? (
              (item.images && item.images.length > 0
                ? item.images
                : [item.imageUrl!]
              ).map((img, idx) => (
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
                        | "Claimed",
                    })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="Pending">Pending</option>
                  <option value="Matched">Matched</option>
                  <option value="Claimed">Claimed</option>
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
            {(item.matchScore || isEditing) && (
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
          </div>
        </div>
      </div>
    </div>
  );
}
