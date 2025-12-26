import { useState, useEffect } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { type Item, getItems } from "../../services/itemService";
import { ItemDetailModal } from "../../components/admin/ItemDetailModal";
import { AddItemModal } from "../../components/admin/AddItemModal";
import { Timestamp } from "firebase/firestore";

interface StatsCardProps {
  title: string;
  value: string | number;
  trend?: {
    value: string;
    direction: "up" | "down";
  };
}

function StatsCard({ title, value, trend }: StatsCardProps) {
  return (
    <div className="stats-card">
      <p className="stats-label">{title}</p>
      <p className="stats-value">{value}</p>
      {trend && (
        <div
          className={cn(
            "stats-trend flex items-center gap-1",
            trend.direction === "up" ? "stats-trend-up" : "stats-trend-down"
          )}
        >
          {trend.direction === "up" ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          )}
          {trend.value}
        </div>
      )}
    </div>
  );
}

export function AdminDashboard() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Fetch items from Firestore
  const fetchItems = async () => {
    try {
      setLoading(true);
      const data = await getItems();
      setItems(data);
    } catch (err) {
      console.error("Error fetching items:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  // Format date for display
  const formatDate = (date: Timestamp | Date) => {
    const d = date instanceof Timestamp ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Calculate stats
  const totalLost = items.filter((i) => i.type === "Lost").length;
  const totalFound = items.filter((i) => i.type === "Found").length;
  const totalMatched = items.filter((i) => i.status === "Matched").length;
  const totalPending = items.filter((i) => i.status === "Pending").length;

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Lost Items" value={totalLost} />
        <StatsCard title="Total Found Items" value={totalFound} />
        <StatsCard title="Successful Matches" value={totalMatched} />
        <StatsCard title="Pending Items" value={totalPending} />
      </div>

      {/* Recent Items Table */}
      <div className="card">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-medium text-text-primary">All Items</h2>
          <div className="flex items-center gap-2">
            <button className="btn-pill btn-secondary text-sm">Filter</button>
            <button className="btn-pill btn-secondary text-sm">Export</button>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-pill btn-primary text-sm"
            >
              + Add Item
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-text-secondary">Loading items...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-text-secondary">
                No items found. Add your first item!
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Item
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Type
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Location
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Date
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Status
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Match Score
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-border hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedItem(item)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-10 h-10 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-xl">
                            📦
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {item.name}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary">
                      {item.type}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary">
                      {item.location.split(",").slice(0, 2).join(", ")}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary">
                      {formatDate(item.date)}
                    </td>
                    <td className="py-3 px-4">
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
                    </td>
                    <td className="py-3 px-4">
                      {item.matchScore ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                item.matchScore >= 90
                                  ? "bg-google-green"
                                  : "bg-google-blue"
                              )}
                              style={{ width: `${item.matchScore}%` }}
                            />
                          </div>
                          <span className="text-sm text-text-primary">
                            {item.matchScore}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-text-secondary">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItem(item);
                        }}
                        className="text-primary text-sm font-medium hover:underline"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdate={() => {
            fetchItems();
            setSelectedItem(null);
          }}
          onDelete={() => {
            fetchItems();
          }}
        />
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <AddItemModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            fetchItems();
          }}
        />
      )}
    </div>
  );
}
