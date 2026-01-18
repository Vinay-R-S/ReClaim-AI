import { useState, useEffect } from "react";
import { handoverService } from "../../services/handoverService";
import {
  ShieldCheck,
  Clock,
  Search,
  ChevronDown,
  ChevronRight,
  Package,
  User,
  MapPin,
  Hash,
  Percent,
  Mail,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface ItemDetails {
  name: string;
  description: string;
  location: string;
  date: any;
  color?: string;
  category?: string;
  tags?: string[];
  imageUrl?: string;
  collectionPoint?: string;
}

interface PersonDetails {
  email: string | null;
  displayName: string | null;
}

interface HandoverRecord {
  id: string;
  matchId: string;
  lostItemId: string;
  foundItemId: string;
  lostPersonId: string;
  foundPersonId: string;
  matchScore: number;
  matchCreatedAt: any;
  lostItemDetails: ItemDetails;
  foundItemDetails: ItemDetails;
  lostPersonDetails: PersonDetails;
  foundPersonDetails: PersonDetails;
  verificationCode: string;
  handoverTime: any;
  createdAt: any;
  status: string;
}

export function HandoversPage() {
  const [handovers, setHandovers] = useState<HandoverRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    try {
      // Handle Firestore Timestamp
      const secs = timestamp._seconds ?? timestamp.seconds;
      if (secs) {
        return new Date(secs * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Invalid Date";
    }
  };

  const filteredHandovers = handovers.filter(
    (h) =>
      h.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.matchId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      h.lostItemDetails?.name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      h.foundItemDetails?.name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()),
  );

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Handover History</h1>
          <p className="text-gray-500 mt-1">
            Complete record of verified item exchanges
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by ID, item name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-80"
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
        <div className="space-y-4">
          {filteredHandovers.map((handover) => (
            <div
              key={handover.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Header Row - Click to Expand */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleExpand(handover.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Expand Icon */}
                    <div className="text-gray-400">
                      {expandedId === handover.id ? (
                        <ChevronDown className="w-5 h-5" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </div>

                    {/* Handover ID & Time */}
                    <div>
                      <div className="flex items-center gap-2">
                        <Hash className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-gray-900">
                          {handover.id?.slice(0, 12)}...
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-500 text-sm mt-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(handover.handoverTime)}
                      </div>
                    </div>

                    {/* Match Score */}
                    <div className="flex items-center gap-2 ml-4">
                      <Percent className="w-4 h-4 text-green-500" />
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-sm font-medium",
                          handover.matchScore >= 80
                            ? "bg-green-100 text-green-700"
                            : handover.matchScore >= 60
                              ? "bg-blue-100 text-blue-700"
                              : "bg-yellow-100 text-yellow-700",
                        )}
                      >
                        {handover.matchScore || 0}% Match
                      </span>
                    </div>
                  </div>

                  {/* Item Names Preview */}
                  <div className="hidden md:flex items-center gap-4 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                      {handover.lostItemDetails?.name || "Lost Item"}
                    </span>
                    <span className="text-gray-300">↔</span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                      {handover.foundItemDetails?.name || "Found Item"}
                    </span>
                  </div>

                  {/* Status Badge */}
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
                    <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                    Completed
                  </span>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedId === handover.id && (
                <div className="border-t border-gray-100 p-6 bg-gray-50">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Lost Item Details */}
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <h4 className="font-semibold text-red-600 flex items-center gap-2 mb-3">
                        <Package className="w-4 h-4" />
                        Lost Item Details
                      </h4>
                      {handover.lostItemDetails ? (
                        <div className="space-y-2 text-sm">
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600 w-24">
                              Name:
                            </span>
                            <span className="text-gray-900">
                              {handover.lostItemDetails.name}
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600 w-24">
                              Description:
                            </span>
                            <span className="text-gray-900 line-clamp-2">
                              {handover.lostItemDetails.description}
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600 w-24">
                              Location:
                            </span>
                            <span className="text-gray-900">
                              {handover.lostItemDetails.location}
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600 w-24">
                              Date:
                            </span>
                            <span className="text-gray-900">
                              {formatDate(handover.lostItemDetails.date)}
                            </span>
                          </div>
                          {handover.lostItemDetails.color && (
                            <div className="flex items-start gap-2">
                              <span className="font-medium text-gray-600 w-24">
                                Color:
                              </span>
                              <span className="text-gray-900">
                                {handover.lostItemDetails.color}
                              </span>
                            </div>
                          )}
                          {handover.lostItemDetails.imageUrl && (
                            <img
                              src={handover.lostItemDetails.imageUrl}
                              alt="Lost item"
                              className="w-20 h-20 rounded-lg object-cover mt-2"
                            />
                          )}
                        </div>
                      ) : (
                        <p className="text-gray-500 text-sm">
                          No details available
                        </p>
                      )}

                      {/* Lost Person */}
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <h5 className="font-medium text-gray-700 flex items-center gap-2 mb-2">
                          <User className="w-4 h-4" />
                          Reporter
                        </h5>
                        <div className="text-sm space-y-1">
                          <p className="flex items-center gap-2 text-gray-600">
                            <Mail className="w-3.5 h-3.5" />
                            {handover.lostPersonDetails?.email || "N/A"}
                          </p>
                          {handover.lostPersonDetails?.displayName && (
                            <p className="text-gray-900">
                              {handover.lostPersonDetails.displayName}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Found Item Details */}
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <h4 className="font-semibold text-green-600 flex items-center gap-2 mb-3">
                        <Package className="w-4 h-4" />
                        Found Item Details
                      </h4>
                      {handover.foundItemDetails ? (
                        <div className="space-y-2 text-sm">
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600 w-24">
                              Name:
                            </span>
                            <span className="text-gray-900">
                              {handover.foundItemDetails.name}
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600 w-24">
                              Description:
                            </span>
                            <span className="text-gray-900 line-clamp-2">
                              {handover.foundItemDetails.description}
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600 w-24">
                              Location:
                            </span>
                            <span className="text-gray-900">
                              {handover.foundItemDetails.location}
                            </span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600 w-24">
                              Date:
                            </span>
                            <span className="text-gray-900">
                              {formatDate(handover.foundItemDetails.date)}
                            </span>
                          </div>
                          {handover.foundItemDetails.color && (
                            <div className="flex items-start gap-2">
                              <span className="font-medium text-gray-600 w-24">
                                Color:
                              </span>
                              <span className="text-gray-900">
                                {handover.foundItemDetails.color}
                              </span>
                            </div>
                          )}
                          {handover.foundItemDetails.collectionPoint && (
                            <div className="flex items-start gap-2">
                              <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                              <span className="text-gray-900">
                                {handover.foundItemDetails.collectionPoint}
                              </span>
                            </div>
                          )}
                          {handover.foundItemDetails.imageUrl && (
                            <img
                              src={handover.foundItemDetails.imageUrl}
                              alt="Found item"
                              className="w-20 h-20 rounded-lg object-cover mt-2"
                            />
                          )}
                        </div>
                      ) : (
                        <p className="text-gray-500 text-sm">
                          No details available
                        </p>
                      )}

                      {/* Found Person */}
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <h5 className="font-medium text-gray-700 flex items-center gap-2 mb-2">
                          <User className="w-4 h-4" />
                          Finder
                        </h5>
                        <div className="text-sm space-y-1">
                          <p className="flex items-center gap-2 text-gray-600">
                            <Mail className="w-3.5 h-3.5" />
                            {handover.foundPersonDetails?.email || "N/A"}
                          </p>
                          {handover.foundPersonDetails?.displayName && (
                            <p className="text-gray-900">
                              {handover.foundPersonDetails.displayName}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* IDs and Timestamps */}
                  <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-gray-500 text-xs uppercase mb-1">
                        Handover ID
                      </p>
                      <p
                        className="font-mono text-gray-900 text-xs truncate"
                        title={handover.id}
                      >
                        {handover.id}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-gray-500 text-xs uppercase mb-1">
                        Match ID
                      </p>
                      <p
                        className="font-mono text-gray-900 text-xs truncate"
                        title={handover.matchId}
                      >
                        {handover.matchId}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-gray-500 text-xs uppercase mb-1">
                        Match Created
                      </p>
                      <p className="text-gray-900 text-xs">
                        {formatDate(handover.matchCreatedAt)}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-gray-500 text-xs uppercase mb-1">
                        Claimed At
                      </p>
                      <p className="text-gray-900 text-xs">
                        {formatDate(handover.handoverTime)}
                      </p>
                    </div>
                  </div>

                  {/* Item IDs */}
                  <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
                    <span>
                      Lost Item ID:{" "}
                      <code className="bg-gray-100 px-1 rounded">
                        {handover.lostItemId}
                      </code>
                    </span>
                    <span>
                      Found Item ID:{" "}
                      <code className="bg-gray-100 px-1 rounded">
                        {handover.foundItemId}
                      </code>
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
