import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { type User } from "../../services/userService";
import { type Item, getItems } from "../../services/itemService";
import { Timestamp } from "firebase/firestore";
import { cn } from "../../lib/utils";

interface UserDetailModalProps {
  user: User;
  itemsCount: number;
  onClose: () => void;
}

export function UserDetailModal({
  user,
  itemsCount,
  onClose,
}: UserDetailModalProps) {
  const [userItems, setUserItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchUserItems = async () => {
      try {
        setLoading(true);
        const allItems = await getItems();
        
        // Filter items by user ID or email
        const filtered = allItems.filter(
          (item) =>
            item.reportedBy === user.uid ||
            item.reportedByEmail === user.email
        );
        
        setUserItems(filtered);
      } catch (error) {
        console.error("Error fetching user items:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserItems();
  }, [user]);

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

  const formatDate = (date: Timestamp | Date | undefined) => {
    if (!date) return "N/A";
    const d = date instanceof Timestamp ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-medium text-text-primary">User Details</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* User Avatar & Basic Info */}
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-border">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || user.email}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary text-white flex items-center justify-center text-xl font-medium">
                {user.displayName
                  ? user.displayName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)
                  : user.email[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <h3 className="text-lg font-medium text-text-primary">
                {user.displayName || "No Name"}
              </h3>
              <p className="text-sm text-text-secondary">{user.email}</p>
            </div>
            <span
              className={cn(
                "badge px-3 py-1",
                (user.status || "active") === "active"
                  ? "badge-active"
                  : "badge-blocked"
              )}
            >
              {(user.status || "active") === "active" ? "Active" : "Blocked"}
            </span>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Email
              </label>
              <p className="text-text-primary">{user.email}</p>
            </div>

            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Status
              </label>
              <span
                className={cn(
                  "badge px-3 py-1",
                  (user.status || "active") === "active"
                    ? "badge-active"
                    : "badge-blocked"
                )}
              >
                {(user.status || "active") === "active" ? "Active" : "Blocked"}
              </span>
            </div>

            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Role
              </label>
              <p className="text-text-primary capitalize">
                {user.role || "user"}
              </p>
            </div>

            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Items Submitted
              </label>
              <p className="text-text-primary">{itemsCount}</p>
            </div>

            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Joined On
              </label>
              <p className="text-text-primary">
                {formatDate(user.createdAt)}
              </p>
            </div>

            <div>
              <label className="text-sm text-text-secondary mb-1 block">
                Last Login
              </label>
              <p className="text-text-primary">
                {formatDate(user.lastLoginAt)}
              </p>
            </div>
          </div>

          {/* User's Items List */}
          <div>
            <label className="text-sm text-text-secondary mb-3 block">
              Submitted Items ({userItems.length})
            </label>
            {loading ? (
              <div className="text-center py-4">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm text-text-secondary">Loading items...</p>
              </div>
            ) : userItems.length === 0 ? (
              <div className="text-center py-8 text-text-secondary text-sm">
                No items submitted yet
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {userItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 border border-border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-text-secondary mt-1">
                          {item.type} · {item.location.split(",")[0]}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "badge text-xs shrink-0",
                          item.status === "Matched" && "badge-matched",
                          item.status === "Pending" && "badge-pending",
                          item.status === "Claimed" && "badge-claimed"
                        )}
                      >
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
