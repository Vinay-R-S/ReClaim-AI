import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Search, RefreshCw, Clock } from "lucide-react";
import { getItems, type Item } from "@/services/itemService";
import { Timestamp } from "firebase/firestore";

export function PendingApprovalsPage() {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    const fetchPendingItems = async () => {
        try {
            setLoading(true);
            const allItems = await getItems();
            // Filter only items with "Pending" status
            const pendingItems = allItems.filter(item => item.status === "Pending");
            setItems(pendingItems);
        } catch (error) {
            console.error("Failed to fetch pending items:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPendingItems();
    }, []);

    const filteredItems = items.filter((item) => {
        const searchLower = searchTerm.toLowerCase();
        return (
            item.name.toLowerCase().includes(searchLower) ||
            item.location.toLowerCase().includes(searchLower) ||
            item.type.toLowerCase().includes(searchLower)
        );
    });

    // Format date for display
    const formatDate = (date: Timestamp | Date | unknown) => {
        try {
            if (!date) return "N/A";

            let d: Date;
            if (date instanceof Timestamp) {
                d = date.toDate();
            } else if (date instanceof Date) {
                d = date;
            } else if (
                typeof date === "object" &&
                date !== null &&
                "_seconds" in date
            ) {
                d = new Date((date as { _seconds: number })._seconds * 1000);
            } else if (
                typeof date === "object" &&
                date !== null &&
                "seconds" in date
            ) {
                d = new Date((date as { seconds: number }).seconds * 1000);
            } else {
                d = new Date(date as string | number);
            }

            if (isNaN(d.getTime())) {
                return "N/A";
            }

            return format(d, "MMM d, yyyy");
        } catch {
            return "N/A";
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Pending Approvals</h1>
                    <p className="text-text-secondary">Items awaiting review and matching</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary" />
                        <input
                            type="text"
                            placeholder="Search pending items..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        />
                    </div>
                    <button
                        onClick={fetchPendingItems}
                        className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className="w-5 h-5 text-text-secondary" />
                    </button>
                </div>
            </div>

            {/* Stats Card */}
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                    <Clock className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                    <p className="text-lg font-bold text-orange-700">{items.length} Pending Items</p>
                    <p className="text-sm text-orange-600">Awaiting match or review</p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                    <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">Item</th>
                                    <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">Type</th>
                                    <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">Location</th>
                                    <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">Reported On</th>
                                    <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">Status</th>
                                    <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">Match %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="text-center py-12 text-text-secondary">
                                            {searchTerm ? "No pending items matching your search" : "No pending items found"}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredItems.map((item) => (
                                        <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3">
                                                    {item.cloudinaryUrls?.[0] || item.imageUrl ? (
                                                        <img
                                                            src={item.cloudinaryUrls?.[0] || item.imageUrl}
                                                            alt={item.name}
                                                            className="w-10 h-10 rounded-lg object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg">
                                                            📦
                                                        </div>
                                                    )}
                                                    <span className="text-sm font-medium text-text-primary">
                                                        {item.name}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.type === "Lost"
                                                    ? "bg-red-100 text-red-700"
                                                    : "bg-green-100 text-green-700"
                                                    }`}>
                                                    {item.type}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-text-secondary">
                                                {item.location.split(",").slice(0, 2).join(", ")}
                                            </td>
                                            <td className="py-3 px-4 text-sm text-text-secondary">
                                                {formatDate(item.createdAt || item.date)}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
                                                    Pending
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-xs font-bold text-text-primary">
                                                {item.matchScore ? `${item.matchScore}%` : "-"}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
