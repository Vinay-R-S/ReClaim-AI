import { useState, useEffect } from "react";
import { UserLayout } from "../../components/layout/UserLayout";
import { useAuth } from "../../context/AuthContext";
import { Package, Calendar, User, ExternalLink } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface HandoverRecord {
  id: string;
  matchId: string;
  lostItemId: string;
  foundItemId: string;
  lostItemDetails: {
    name: string;
  };
  foundItemDetails: {
    name: string;
  };
  lostPersonDetails: {
    userId: string;
    displayName: string;
  };
  foundPersonDetails: {
    userId: string;
    displayName: string;
  };
  handoverTime: { seconds: number } | Date | string | number;
  blockchainTxHash?: string;
  blockchainRecorded?: boolean;
}

export function HandoversPage() {
  const { user } = useAuth();
  const [handovers, setHandovers] = useState<HandoverRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;

    // Fetch user's handovers
    fetch(`${API_URL}/api/handovers/user/${user.uid}`)
      .then((res) => res.json())
      .then((data) => {
        setHandovers(data.handovers || []);
      })
      .catch((err) => {
        console.error("Failed to fetch handovers:", err);
        setHandovers([]);
      })
      .finally(() => setLoading(false));
  }, [user?.uid]);

  const formatDate = (
    date: { seconds: number } | Date | string | number | undefined | null,
  ) => {
    if (!date) return "Date not available";

    let d: Date;

    // Handle Firestore Timestamp object
    if (typeof date === "object" && "seconds" in date) {
      d = new Date(date.seconds * 1000);
    }
    // Handle ISO string or other string formats
    else if (typeof date === "string") {
      d = new Date(date);
    }
    // Handle numeric timestamp (milliseconds)
    else if (typeof date === "number") {
      d = new Date(date);
    }
    // Handle Date object
    else {
      d = new Date(date);
    }

    // Check for invalid date
    if (isNaN(d.getTime())) {
      return "Date not available";
    }

    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <UserLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </UserLayout>
    );
  }

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Handover History
          </h1>
          <p className="text-text-secondary mt-1">
            View all your completed item handovers
          </p>
        </div>

        {/* Handovers List */}
        {handovers.length === 0 ? (
          <div className="card p-12 text-center">
            <Package className="w-16 h-16 text-text-secondary mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-text-primary mb-2">
              No handovers yet
            </h3>
            <p className="text-sm text-text-secondary">
              Complete a handover to see it here. Handovers are recorded
              immutably on the blockchain.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {handovers.map((handover) => (
              <HandoverCard
                key={handover.id}
                handover={handover}
                currentUserId={user?.uid || ""}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>
    </UserLayout>
  );
}

interface HandoverCardProps {
  handover: HandoverRecord;
  currentUserId: string;
  formatDate: (
    date: { seconds: number } | Date | string | number | undefined | null,
  ) => string;
}

function HandoverCard({
  handover,
  currentUserId,
  formatDate,
}: HandoverCardProps) {
  const isLostPerson = handover.lostPersonDetails.userId === currentUserId;
  const isFoundPerson = handover.foundPersonDetails.userId === currentUserId;

  return (
    <div className="card p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-lg text-text-primary">
              {handover.lostItemDetails.name}
            </h3>
            {handover.blockchainRecorded && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                ✓ Blockchain
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <InfoRow
              icon={<User className="w-4 h-4 text-red-600" />}
              label="Lost by"
              value={handover.lostPersonDetails.displayName || "Unknown"}
              highlight={isLostPerson}
              badge={isLostPerson ? "+10 credits" : undefined}
            />
            <InfoRow
              icon={<User className="w-4 h-4 text-green-600" />}
              label="Found by"
              value={handover.foundPersonDetails.displayName || "Unknown"}
              highlight={isFoundPerson}
              badge={isFoundPerson ? "+20 credits" : undefined}
            />
            <InfoRow
              icon={<Calendar className="w-4 h-4 text-blue-600" />}
              label="Completed"
              value={formatDate(handover.handoverTime)}
            />
            {handover.blockchainTxHash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${handover.blockchainTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="w-4 h-4" />
                <span>View on Etherscan</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  badge?: string;
}

function InfoRow({ icon, label, value, highlight, badge }: InfoRowProps) {
  return (
    <div className="flex items-start gap-2">
      {icon}
      <div className="flex-1">
        <p className="text-xs text-text-secondary">{label}</p>
        <p
          className={`text-sm ${highlight ? "font-semibold text-primary" : "text-text-primary"}`}
        >
          {value}
          {badge && (
            <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
