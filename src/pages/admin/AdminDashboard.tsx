import { ArrowUp, ArrowDown, MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";

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

interface RecentItem {
  id: string;
  name: string;
  description: string;
  type: "Lost" | "Found";
  location: string;
  date: string;
  status: "Matched" | "Pending" | "Claimed";
  matchScore?: number;
  icon: string;
}

const recentItems: RecentItem[] = [
  {
    id: "1",
    name: "Black Laptop Bag",
    description: "Dell, 15 inch",
    type: "Lost",
    location: "Main Library",
    date: "Dec 23, 2024",
    status: "Matched",
    matchScore: 92,
    icon: "💼",
  },
  {
    id: "2",
    name: "Car Keys",
    description: "Toyota, with keychain",
    type: "Found",
    location: "Parking Lot B",
    date: "Dec 23, 2024",
    status: "Pending",
    icon: "🔑",
  },
  {
    id: "3",
    name: "Brown Wallet",
    description: "Leather, with ID card",
    type: "Found",
    location: "Cafeteria",
    date: "Dec 22, 2024",
    status: "Claimed",
    matchScore: 87,
    icon: "👛",
  },
];

export function AdminDashboard() {
  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Lost Items"
          value={156}
          trend={{ value: "12% this week", direction: "up" }}
        />
        <StatsCard
          title="Total Found Items"
          value={89}
          trend={{ value: "8% this week", direction: "up" }}
        />
        <StatsCard
          title="Successful Matches"
          value={47}
          trend={{ value: "15% this week", direction: "up" }}
        />
        <StatsCard
          title="Pending Handovers"
          value={12}
          trend={{ value: "3 from yesterday", direction: "down" }}
        />
      </div>

      {/* Recent Items Table */}
      <div className="card">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-medium text-text-primary">Recent Items</h2>
          <div className="flex items-center gap-2">
            <button className="btn-pill btn-secondary text-sm">Filter</button>
            <button className="btn-pill btn-secondary text-sm">Export</button>
            <button className="btn-pill btn-primary text-sm">+ Add Item</button>
          </div>
        </div>

        <div className="overflow-x-auto">
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
              {recentItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border hover:bg-gray-50 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-xl">
                        {item.icon}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {item.name}
                        </p>
                        <p className="text-xs text-text-secondary">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm text-text-primary">
                    {item.type}
                  </td>
                  <td className="py-3 px-4 text-sm text-text-primary">
                    {item.location}
                  </td>
                  <td className="py-3 px-4 text-sm text-text-primary">
                    {item.date}
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
                    <button className="text-primary text-sm font-medium hover:underline">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
