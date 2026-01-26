import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Search, RefreshCw, Package } from "lucide-react";
import { getAllMatches, type Match } from "@/services/matchService";
import { getItems, type Item } from "@/services/itemService";

// Extended match with item names
interface MatchWithNames extends Match {
  lostItemName?: string;
  foundItemName?: string;
  lostItemImage?: string;
  foundItemImage?: string;
}

export function MatchesPage() {
  const [matches, setMatches] = useState<MatchWithNames[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchMatches = async () => {
    try {
      setLoading(true);

      // Fetch matches and items in parallel
      const [matchesData, itemsData] = await Promise.all([
        getAllMatches(),
        getItems(),
      ]);

      // Create a lookup map for items by ID
      const itemsMap = new Map<string, Item>();
      itemsData.forEach((item) => {
        itemsMap.set(item.id, item);
      });

      // Enrich matches with item names
      const enrichedMatches: MatchWithNames[] = matchesData.map((match) => {
        const lostItem = itemsMap.get(match.lostItemId);
        const foundItem = itemsMap.get(match.foundItemId);
        return {
          ...match,
          lostItemName: lostItem?.name || "Unknown Item",
          foundItemName: foundItem?.name || "Unknown Item",
          lostItemImage: lostItem?.cloudinaryUrls?.[0] || lostItem?.imageUrl,
          foundItemImage: foundItem?.cloudinaryUrls?.[0] || foundItem?.imageUrl,
        };
      });

      setMatches(enrichedMatches);
    } catch (error) {
      console.error("Failed to fetch matches:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatches();
  }, []);

  const filteredMatches = matches.filter((match) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      match.lostItemName?.toLowerCase().includes(searchLower) ||
      match.foundItemName?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Matches</h1>
          <p className="text-text-secondary">Review and verify item matches</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="text"
              placeholder="Search by item name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <button
            onClick={fetchMatches}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="Refresh matches"
          >
            <RefreshCw className="w-5 h-5 text-text-secondary" />
          </button>
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
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Lost Item
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Found Item
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Score
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Status
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredMatches.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="text-center py-12 text-text-secondary"
                    >
                      {searchTerm
                        ? "No matches found matching your search"
                        : "No matches found"}
                    </td>
                  </tr>
                ) : (
                  filteredMatches.map((match) => (
                    <tr
                      key={match.id}
                      className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {match.lostItemImage ? (
                            <img
                              src={match.lostItemImage}
                              alt={match.lostItemName}
                              className="w-10 h-10 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                              <Package className="w-5 h-5 text-red-400" />
                            </div>
                          )}
                          <span className="text-sm font-medium text-text-primary">
                            {match.lostItemName}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {match.foundItemImage ? (
                            <img
                              src={match.foundItemImage}
                              alt={match.foundItemName}
                              className="w-10 h-10 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                              <Package className="w-5 h-5 text-green-400" />
                            </div>
                          )}
                          <span className="text-sm font-medium text-text-primary">
                            {match.foundItemName}
                          </span>
                        </div>
                      </td>
                      <td
                        className={`py-3 px-4 text-sm font-bold ${match.matchScore >= 60 ? "text-green-600" : "text-blue-600"}`}
                      >
                        {match.matchScore}%
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium capitalize">
                          {match.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-text-secondary">
                        {(() => {
                          if (!match.createdAt) return "-";
                          const ts = match.createdAt as {
                            _seconds?: number;
                            seconds?: number;
                          };
                          const secs = ts._seconds ?? ts.seconds;
                          if (secs)
                            return format(new Date(secs * 1000), "MMM d, yyyy");
                          return "-";
                        })()}
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
