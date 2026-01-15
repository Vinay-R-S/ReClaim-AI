import { useState, useEffect } from "react";
import { handoverService } from "../../services/handoverService";
import { ShieldCheck, Clock, MapPin, Search } from "lucide-react";

export function HandoversPage() {
  const [handovers, setHandovers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const data = await handoverService.getHistory();
      setHandovers(data || []);
    } catch (error) {
      console.error("Failed to fetch handover history", error);
    } finally {
      setLoading(false);
    }
  };

  // Format timestamp
  const formatDate = (timestamp: any) => {
    if (!timestamp) return "N/A";
    // Handle Firestore Timestamp
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const filteredHandovers = handovers.filter(
    (h) =>
      h.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (h.matchId || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Handover History</h1>
          <p className="text-gray-500 mt-1">
            Track completed and verified item exchanges
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : filteredHandovers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">
            No Handovers Yet
          </h3>
          <p className="text-gray-500 mt-2">
            Completed item exchanges will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 font-medium">Handover ID / Date</th>
                  <th className="px-6 py-4 font-medium">Match Details</th>
                  <th className="px-6 py-4 font-medium">Participants</th>
                  <th className="px-6 py-4 font-medium">Verification</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredHandovers.map((handover) => (
                  <tr
                    key={handover.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div
                        className="font-medium text-gray-900 truncate max-w-[120px]"
                        title={handover.id}
                      >
                        #{handover.id.slice(0, 8)}
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-500 mt-1 text-xs">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(handover.handoverTime)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-gray-900">
                        Match #{handover.matchId.slice(0, 8)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Items: {handover.lostItemId.slice(0, 6)}... /{" "}
                        {handover.foundItemId.slice(0, 6)}...
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-gray-600">
                          <span className="w-5 h-5 bg-red-100 text-red-600 rounded flex items-center justify-center text-[10px] font-bold">
                            L
                          </span>
                          <span className="truncate max-w-[150px]">
                            {handover.userEmail}
                          </span>
                          {/* Assuming we store userEmail or fetch it. If specific field differs, adjust. */}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-gray-700">
                        <ShieldCheck className="w-4 h-4 text-green-600" />
                        <span>Verified via Code</span>
                      </div>
                      {handover.location && (
                        <div className="flex items-center gap-1.5 text-gray-500 mt-1 text-xs">
                          <MapPin className="w-3.5 h-3.5" />
                          {typeof handover.location === "string"
                            ? handover.location
                            : "Location Verified"}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
                        Completed
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
