import { useState, useEffect, useCallback } from "react";
import { Timestamp } from "firebase/firestore";
import { UserLayout } from "../../components/layout/UserLayout";
import { useAuth } from "../../context/AuthContext";
import { type Item } from "../../services/itemService";
import { EditReportModal } from "../../components/user/EditReportModal";
import { ImageCarousel } from "../../components/ui/ImageCarousel";
import { Package, MapPin, Calendar, Edit2, Eye } from "lucide-react";
import { cn } from "../../lib/utils";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function MyReportsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  // Fetch user's items
  const fetchMyItems = useCallback(async () => {
    if (!user?.uid) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/items/user/${user.uid}`);
      if (response.ok) {
        const data = await response.json();
        setItems(data.items || []);
      }
    } catch (error) {
      console.error("Error fetching my reports:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchMyItems();
  }, [fetchMyItems]);

  const formatDate = (date: Timestamp | Date | unknown) => {
    try {
      if (!date) return "Date not available";

      let d: Date;
      if (date instanceof Timestamp) {
        d = date.toDate();
      } else if (date instanceof Date) {
        d = date;
      } else if (
        typeof date === "object" &&
        date !== null &&
        ("seconds" in date || "_seconds" in date)
      ) {
        // Handle Firestore Timestamp-like object (both seconds and _seconds formats)
        const seconds =
          (date as { seconds?: number; _seconds?: number }).seconds ??
          (date as { _seconds: number })._seconds;
        d = new Date(seconds * 1000);
      } else if (typeof date === "string") {
        // Handle ISO string
        d = new Date(date);
      } else {
        d = new Date(date as number);
      }

      // Check if date is valid
      if (isNaN(d.getTime())) {
        return "Date not available";
      }

      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Date not available";
    }
  };

  const getImageUrl = (item: Item) => {
    return item.imageUrl || item.cloudinaryUrls?.[0];
  };

  // Get all images from an item for carousel display
  const getAllImages = (item: Item): string[] => {
    const images: string[] = [];
    if (item.cloudinaryUrls && item.cloudinaryUrls.length > 0) {
      images.push(...item.cloudinaryUrls);
    }
    if (item.imageUrl && !images.includes(item.imageUrl)) {
      images.push(item.imageUrl);
    }
    if (item.images && item.images.length > 0) {
      images.push(...item.images.filter((img) => !images.includes(img)));
    }
    return images;
  };

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">My Reports</h1>
            <p className="text-text-secondary mt-1">
              View and manage items you've reported
            </p>
          </div>
        </div>

        {/* Items Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="card p-8 text-center">
            <Package className="w-12 h-12 text-text-secondary mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-2">
              No reports yet
            </h3>
            <p className="text-text-secondary">
              When you report a lost or found item, it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="card overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => setSelectedItem(item)}
              >
                {/* Image */}
                <div className="h-40 bg-gray-100 relative">
                  {getImageUrl(item) ? (
                    <img
                      src={getImageUrl(item)}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-12 h-12 text-text-secondary" />
                    </div>
                  )}
                  {/* Type Badge */}
                  <span
                    className={cn(
                      "absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium",
                      item.type === "Lost"
                        ? "bg-red-100 text-red-700"
                        : "bg-green-100 text-green-700",
                    )}
                  >
                    {item.type}
                  </span>
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-semibold text-text-primary truncate">
                    {item.name}
                  </h3>
                  <p className="text-sm text-text-secondary line-clamp-2 mt-1">
                    {item.description}
                  </p>

                  <div className="mt-3 space-y-1">
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <MapPin className="w-4 h-4" />
                      <span className="truncate">{item.location}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(item.date)}</span>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="mt-3 flex items-center justify-between">
                    <span
                      className={cn(
                        "px-2 py-1 rounded-full text-xs font-medium border",
                        item.status === "Matched" &&
                          "bg-blue-50 text-blue-700 border-blue-200",
                        item.status === "Pending" &&
                          "bg-yellow-50 text-yellow-700 border-yellow-200",
                        item.status === "Claimed" &&
                          "bg-green-50 text-green-700 border-green-200",
                      )}
                    >
                      {item.status}
                    </span>
                    <button className="text-primary text-sm font-medium flex items-center gap-1">
                      <Eye className="w-4 h-4" />
                      View
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Detail Modal */}
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setSelectedItem(null)}
            />
            <div className="relative bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              {/* Image Carousel */}
              <ImageCarousel
                images={getAllImages(selectedItem)}
                alt={selectedItem.name}
                className="rounded-t-2xl"
                imageClassName="rounded-t-2xl"
              />

              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <span
                      className={cn(
                        "badge mb-2",
                        selectedItem.type === "Lost"
                          ? "bg-red-100 text-red-700"
                          : "bg-green-100 text-green-700",
                      )}
                    >
                      {selectedItem.type}
                    </span>
                    <h2 className="text-xl font-bold text-text-primary">
                      {selectedItem.name}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="text-text-secondary hover:text-text-primary"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <p className="text-text-secondary mt-3">
                  {selectedItem.description}
                </p>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-text-secondary" />
                    <span className="text-text-primary">
                      {selectedItem.location}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-text-secondary" />
                    <span className="text-text-primary">
                      {formatDate(selectedItem.date)}
                    </span>
                  </div>
                </div>

                {selectedItem.tags && selectedItem.tags.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm text-text-secondary mb-2">Tags</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedItem.tags.map((tag, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 bg-gray-100 rounded-full text-xs text-text-primary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="flex-1 py-2 border border-border rounded-lg hover:bg-gray-50"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setEditingItem(selectedItem);
                      setSelectedItem(null);
                    }}
                    className="flex-1 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover flex items-center justify-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Report
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Report Modal */}
        {editingItem && (
          <EditReportModal
            item={editingItem}
            onClose={() => setEditingItem(null)}
            onUpdate={() => {
              fetchMyItems();
              setEditingItem(null);
            }}
          />
        )}
      </div>
    </UserLayout>
  );
}
