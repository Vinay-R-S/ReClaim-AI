import { useState, useEffect, useCallback } from "react";
import { format, subDays, startOfDay } from "date-fns";
import {
  Package,
  Search,
  TrendingUp,
  Users,
  CheckCircle,
  Clock,
  Activity,
  RefreshCw,
  Zap,
  HandMetal,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { getItems, type Item } from "@/services/itemService";
import { getAllMatchesWithHistory, type Match } from "@/services/matchService";
import { handoverService } from "@/services/handoverService";

// ============================================================================
// TYPES
// ============================================================================
interface KPIData {
  totalItems: number;
  activeLost: number;
  activeFound: number;
  totalMatches: number;
  pendingReview: number;
  claimed: number;
  matched: number;
  matchSuccessRate: number;
}

interface HandoverRecord {
  id: string;
  matchId: string;
  lostItemId: string;
  foundItemId: string;
  itemName: string;
  handoverTime: { seconds: number };
  status: string;
}

interface ScoreDistribution {
  range: string;
  count: number;
  color: string;
}

interface TrendData {
  date: string;
  matches: number;
}

// ============================================================================
// ANIMATED COUNT-UP HOOK
// ============================================================================
function useCountUp(end: number, duration: number = 1000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (end === 0) {
      setCount(0);
      return;
    }

    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration]);

  return count;
}

// ============================================================================
// KPI CARD COMPONENT
// ============================================================================
interface KPICardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  subtext: string;
  gradient: string;
  isPercentage?: boolean;
}

function KPICard({
  title,
  value,
  icon,
  subtext,
  gradient,
  isPercentage,
}: KPICardProps) {
  const animatedValue = useCountUp(value);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl p-5 transition-all duration-300",
        "hover:scale-[1.02] hover:shadow-xl cursor-pointer",
        "border border-white/20",
        gradient
      )}
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            {icon}
          </div>
        </div>

        <p className="text-3xl font-bold text-white mb-1">
          {animatedValue.toLocaleString()}
          {isPercentage ? "%" : ""}
        </p>
        <p className="text-white/90 font-medium text-sm">{title}</p>
        <p className="text-white/70 text-xs mt-1">{subtext}</p>
      </div>
    </div>
  );
}

// ============================================================================
// SKELETON LOADER
// ============================================================================
function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 bg-gray-100 animate-pulse">
      <div className="w-10 h-10 bg-gray-200 rounded-xl mb-3" />
      <div className="h-8 bg-gray-200 rounded w-20 mb-2" />
      <div className="h-4 bg-gray-200 rounded w-32" />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-40 mb-4" />
      <div className="h-64 bg-gray-100 rounded-xl" />
    </div>
  );
}

// ============================================================================
// CHART: MATCH SCORE DISTRIBUTION
// ============================================================================
interface MatchScoreChartProps {
  data: ScoreDistribution[];
}

function MatchScoreChart({ data }: MatchScoreChartProps) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-text-primary">
          Match Score Distribution
        </h3>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="range" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              borderRadius: "12px",
              border: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
            formatter={(value: any) => [`${value} matches`, "Count"]}
          />
          <Bar dataKey="count" radius={[8, 8, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 justify-center">
        {data.map((item, index) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-text-secondary">{item.range}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// CHART: MATCHES OVER TIME (TREND)
// ============================================================================
interface MatchTrendChartProps {
  data: TrendData[];
  timeRange: "7d" | "30d" | "all";
  onRangeChange: (range: "7d" | "30d" | "all") => void;
}

function MatchTrendChart({
  data,
  timeRange,
  onRangeChange,
}: MatchTrendChartProps) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-text-primary">Matches Over Time</h3>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(["7d", "30d", "all"] as const).map((range) => (
            <button
              key={range}
              onClick={() => onRangeChange(range)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                timeRange === range
                  ? "bg-white text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {range === "7d"
                ? "7 Days"
                : range === "30d"
                ? "30 Days"
                : "All Time"}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
          margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              borderRadius: "12px",
              border: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          />
          <Line
            type="monotone"
            dataKey="matches"
            stroke="#4285f4"
            strokeWidth={3}
            dot={{ fill: "#4285f4", strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: "#4285f4" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================================
// CHART: MATCH EFFICIENCY DONUT
// ============================================================================
interface EfficiencyDonutProps {
  matched: number;
  unmatched: number;
}

function EfficiencyDonut({ matched, unmatched }: EfficiencyDonutProps) {
  const total = matched + unmatched;
  const efficiency = total > 0 ? Math.round((matched / total) * 100) : 0;

  const data = [
    { name: "Matched", value: matched, color: "#22c55e" },
    { name: "Unmatched", value: unmatched, color: "#e5e7eb" },
  ];

  return (
    <div
      className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm h-full"
      style={{ minHeight: "340px" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle className="w-5 h-5 text-green-500" />
        <h3 className="font-semibold text-text-primary">Match Efficiency</h3>
      </div>

      <div className="relative">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: "12px",
                border: "none",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>

        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center -mt-4">
            <p className="text-3xl font-bold text-text-primary">
              {efficiency}%
            </p>
            <p className="text-xs text-text-secondary">Success Rate</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// RECENT MATCHES PANEL
// ============================================================================
interface RecentMatchesPanelProps {
  matches: Match[];
  itemsMap: Map<string, Item>;
}

function RecentMatchesPanel({ matches, itemsMap }: RecentMatchesPanelProps) {
  const recentMatches = matches.slice(0, 3); // Show only 3 recent matches

  const getScoreColor = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-blue-500";
    if (score >= 40) return "bg-yellow-500";
    return "bg-red-500";
  };

  const formatMatchDate = (createdAt: unknown) => {
    if (!createdAt) return "N/A";
    const ts = createdAt as { _seconds?: number; seconds?: number };
    const secs = ts._seconds ?? ts.seconds;
    if (secs) return format(new Date(secs * 1000), "MMM d, h:mm a");
    return "N/A";
  };

  return (
    <div
      className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm h-full"
      style={{ minHeight: "340px" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-500" />
          <h3 className="font-semibold text-text-primary">Recent AI Matches</h3>
        </div>
        <span className="text-xs text-text-secondary bg-gray-100 px-2 py-1 rounded-full">
          Last {recentMatches.length} matches
        </span>
      </div>

      {recentMatches.length === 0 ? (
        <div className="text-center py-8 text-text-secondary">
          <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No matches yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {recentMatches.map((match) => {
            const lostItem = itemsMap.get(match.lostItemId);
            const foundItem = itemsMap.get(match.foundItemId);

            return (
              <div
                key={match.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer group"
              >
                {/* Lost Item */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {lostItem?.cloudinaryUrls?.[0] ? (
                    <img
                      src={lostItem.cloudinaryUrls[0]}
                      alt={lostItem?.name || "Lost Item"}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center text-lg">
                      <Search className="w-5 h-5 text-red-500" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {lostItem?.name || "Unknown"}
                    </p>
                    <p className="text-xs text-red-500">Lost</p>
                  </div>
                </div>

                {/* Arrow + Score */}
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={cn(
                      "px-2 py-0.5 rounded-full text-white text-xs font-bold",
                      getScoreColor(match.matchScore)
                    )}
                  >
                    {match.matchScore}%
                  </div>
                  <span className="text-gray-400">↔</span>
                </div>

                {/* Found Item */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {foundItem?.cloudinaryUrls?.[0] ? (
                    <img
                      src={foundItem.cloudinaryUrls[0]}
                      alt={foundItem?.name || "Found Item"}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-lg">
                      <Package className="w-5 h-5 text-green-500" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {foundItem?.name || "Unknown"}
                    </p>
                    <p className="text-xs text-green-500">Found</p>
                  </div>
                </div>

                {/* Timestamp */}
                <p className="text-xs text-text-secondary hidden lg:block">
                  {formatMatchDate(match.createdAt)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// ============================================================================
// CHART: HANDOVER TREND
// ============================================================================
interface HandoverTrendChartProps {
  handovers: HandoverRecord[];
  timeRange: "7d" | "30d" | "all";
}

function HandoverTrendChart({ handovers, timeRange }: HandoverTrendChartProps) {
  // Calculate trend data based on time range
  const getTrendData = () => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const result: { date: string; handovers: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const day = startOfDay(subDays(new Date(), i));
      const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);

      const count = handovers.filter((h) => {
        const secs = h.handoverTime?.seconds;
        if (!secs) return false;
        const handoverDate = new Date(secs * 1000);
        return handoverDate >= day && handoverDate < dayEnd;
      }).length;

      result.push({
        date: format(day, timeRange === "7d" ? "EEE" : "MMM d"),
        handovers: count,
      });
    }

    return result;
  };

  const data = getTrendData();
  const totalHandovers = handovers.length;

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-500" />
          <h3 className="font-semibold text-text-primary">Handover History</h3>
        </div>
        <span className="text-xs text-text-secondary bg-green-100 text-green-700 px-2 py-1 rounded-full">
          {totalHandovers} completed
        </span>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              borderRadius: "12px",
              border: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
            formatter={(value: any) => [`${value} handovers`, "Completed"]}
          />
          <Bar dataKey="handovers" fill="#22c55e" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================
export function MainDashboard() {
  const [items, setItems] = useState<Item[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [handovers, setHandovers] = useState<HandoverRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "all">("7d");

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const [itemsData, matchesData, handoverData] = await Promise.all([
        getItems(),
        getAllMatchesWithHistory(),
        handoverService.getHistory().catch(() => []), // Graceful fallback
      ]);
      setItems(itemsData);
      setMatches(matchesData);
      setHandovers(handoverData || []);
      setLastRefresh(new Date());
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + auto-refresh every 30 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Create items map for quick lookup
  const itemsMap = new Map(items.map((item) => [item.id, item]));

  // Calculate KPI data
  const kpiData: KPIData = {
    totalItems: items.length,
    activeLost: items.filter((i) => i.type === "Lost" && i.status === "Pending")
      .length,
    activeFound: items.filter(
      (i) => i.type === "Found" && i.status === "Pending"
    ).length,
    totalMatches: matches.length,
    pendingReview: items.filter((i) => i.status === "Pending").length,
    claimed: items.filter((i) => i.status === "Claimed").length,
    matched: items.filter((i) => i.status === "Matched").length,
    matchSuccessRate:
      items.length > 0
        ? Math.round(
            (items.filter(
              (i) => i.status === "Matched" || i.status === "Claimed"
            ).length /
              items.length) *
              100
          )
        : 0,
  };

  // Calculate score distribution
  const scoreDistribution: ScoreDistribution[] = [
    {
      range: "0-30%",
      count: matches.filter((m) => m.matchScore <= 30).length,
      color: "#ef4444",
    },
    {
      range: "31-50%",
      count: matches.filter((m) => m.matchScore > 30 && m.matchScore <= 50)
        .length,
      color: "#f59e0b",
    },
    {
      range: "51-70%",
      count: matches.filter((m) => m.matchScore > 50 && m.matchScore <= 70)
        .length,
      color: "#3b82f6",
    },
    {
      range: "71-100%",
      count: matches.filter((m) => m.matchScore > 70).length,
      color: "#22c55e",
    },
  ];

  // Calculate trend data based on time range
  const getTrendData = (): TrendData[] => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const result: TrendData[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const day = startOfDay(subDays(new Date(), i));
      const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);

      const count = matches.filter((m) => {
        const ts = m.createdAt as { _seconds?: number; seconds?: number };
        const secs = ts?._seconds ?? ts?.seconds;
        if (!secs) return false;
        const matchDate = new Date(secs * 1000);
        return matchDate >= day && matchDate < dayEnd;
      }).length;

      result.push({
        date: format(day, timeRange === "7d" ? "EEE" : "MMM d"),
        matches: count,
      });
    }

    return result;
  };

  // Efficiency data
  const matchedItems = items.filter((i) => i.status === "Matched").length;
  const unmatchedItems = items.filter((i) => i.status !== "Matched").length;

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        {/* Skeleton Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonChart />
          <SkeletonChart />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Dashboard Overview
          </h1>
          <p className="text-text-secondary text-sm">
            AI-powered insights for your lost & found system
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">
            Last updated: {format(lastRefresh, "h:mm:ss a")}
          </span>
          <button
            onClick={fetchData}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="Refresh data"
          >
            <RefreshCw className="w-5 h-5 text-text-secondary" />
          </button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <KPICard
          title="Total Items"
          value={kpiData.totalItems}
          icon={<Package className="w-5 h-5 text-white" />}
          subtext="Lost + Found items"
          gradient="bg-gradient-to-br from-blue-500 to-blue-600"
        />
        <KPICard
          title="Active Lost"
          value={kpiData.activeLost}
          icon={<Search className="w-5 h-5 text-white" />}
          subtext="Awaiting match"
          gradient="bg-gradient-to-br from-red-500 to-red-600"
        />
        <KPICard
          title="Total Matches"
          value={kpiData.totalMatches}
          icon={<CheckCircle className="w-5 h-5 text-white" />}
          subtext="AI matches found"
          gradient="bg-gradient-to-br from-green-500 to-green-600"
        />
        <KPICard
          title="Claimed"
          value={kpiData.claimed}
          icon={<HandMetal className="w-5 h-5 text-white" />}
          subtext="Successfully handed over"
          gradient="bg-gradient-to-br from-purple-500 to-purple-600"
        />
        <KPICard
          title="Pending Review"
          value={kpiData.pendingReview}
          icon={<Clock className="w-5 h-5 text-white" />}
          subtext="Items to process"
          gradient="bg-gradient-to-br from-orange-500 to-orange-600"
        />
        <KPICard
          title="Match Rate"
          value={kpiData.matchSuccessRate}
          icon={<TrendingUp className="w-5 h-5 text-white" />}
          subtext="Overall efficiency"
          gradient="bg-gradient-to-br from-teal-500 to-teal-600"
          isPercentage
        />
      </div>

      {/* Charts Row 1: Score Distribution + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MatchScoreChart data={scoreDistribution} />
        <MatchTrendChart
          data={getTrendData()}
          timeRange={timeRange}
          onRangeChange={setTimeRange}
        />
      </div>

      {/* Charts Row 2: Efficiency + Recent Matches */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <EfficiencyDonut matched={matchedItems} unmatched={unmatchedItems} />
        <div className="lg:col-span-2">
          <RecentMatchesPanel matches={matches} itemsMap={itemsMap} />
        </div>
      </div>

      {/* Charts Row 3: Handover History */}
      <HandoverTrendChart handovers={handovers} timeRange={timeRange} />

      {/* Quick Stats Section */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-text-primary">Quick Statistics</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-4 bg-red-50 rounded-xl">
            <p className="text-2xl font-bold text-red-600">
              {items.filter((i) => i.type === "Lost").length}
            </p>
            <p className="text-sm text-text-secondary">Lost</p>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-xl">
            <p className="text-2xl font-bold text-blue-600">
              {items.filter((i) => i.type === "Found").length}
            </p>
            <p className="text-sm text-text-secondary">Found</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-xl">
            <p className="text-2xl font-bold text-green-600">{matchedItems}</p>
            <p className="text-sm text-text-secondary">Matched</p>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-xl">
            <p className="text-2xl font-bold text-purple-600">
              {kpiData.claimed}
            </p>
            <p className="text-sm text-text-secondary">Claimed</p>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-xl">
            <p className="text-2xl font-bold text-orange-500">
              {kpiData.pendingReview}
            </p>
            <p className="text-sm text-text-secondary">Pending</p>
          </div>
        </div>
      </div>
    </div>
  );
}
