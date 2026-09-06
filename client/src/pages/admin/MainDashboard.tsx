/**
 * The admin dashboard.
 *
 * Data in, layout out. The KPI cards, the four charts and the recent-matches
 * panel are in `components/admin/dashboard`; what is left here is which
 * numbers they are given.
 */

import { useCallback, useEffect, useState } from 'react';
import { format, startOfDay, subDays } from 'date-fns';
import {
  CheckCircle,
  Clock,
  HandMetal,
  Package,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
} from '@/lib/icons';
import { useItems } from '@/hooks/useItems';
import { useMatches } from '@/hooks/useMatches';
import { useHandovers } from '@/hooks/useHandovers';
import { toDate } from '@/lib/timestamps';
import {
  KPICard,
  SkeletonCard,
  SkeletonChart,
  type KPIData,
  type ScoreDistribution,
  type TrendData,
} from '@/components/admin/dashboard/DashboardCards';
import {
  EfficiencyDonut,
  HandoverTrendChart,
  MatchScoreChart,
  MatchTrendChart,
  RecentMatchesPanel,
} from '@/components/admin/dashboard/DashboardCharts';
import { ItemHeatmap } from '@/components/admin/ItemHeatmap';

/** How often the dashboard re-reads its three collections. */
const REFRESH_INTERVAL_MS = 30000;

export function MainDashboard() {
  const { items, loading: itemsLoading, reload: reloadItems } = useItems();
  const { matches, reload: reloadMatches } = useMatches({ includeHistory: true });
  const { handovers, reload: reloadHandovers } = useHandovers('all');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');

  const loading = itemsLoading;

  const fetchData = useCallback(
    async ({ silent = false } = {}) => {
      await Promise.all([
        reloadItems({ silent }),
        reloadMatches({ silent }),
        reloadHandovers({ silent }),
      ]);
      setLastRefresh(new Date());
    },
    [reloadItems, reloadMatches, reloadHandovers],
  );

  // Auto-refresh. PERF-06 replaces the three collection reads with one
  // aggregate endpoint; until then this is the same three the screen already
  // needed on mount.
  useEffect(() => {
    // Silent: replacing every chart with a skeleton twice a minute is not a
    // refresh anyone asked for.
    const interval = setInterval(() => {
      void fetchData({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchData]);

  // Create items map for quick lookup
  const itemsMap = new Map(items.map((item) => [item.id, item]));

  // Calculate KPI data
  // Note: Claimed/Matched should only count LOST items (owners claim, finders hand over)
  const lostItems = items.filter((i) => i.type === 'Lost');
  const foundItems = items.filter((i) => i.type === 'Found');

  const kpiData: KPIData = {
    totalItems: items.length,
    activeLost: lostItems.filter((i) => i.status === 'Pending').length,
    activeFound: foundItems.filter((i) => i.status === 'Pending').length,
    totalMatches: matches.length, // Match pairs from AI matching
    pendingReview: items.filter((i) => i.status === 'Pending').length,
    // Only Lost items can be "Claimed" (owner claims their item)
    claimed: lostItems.filter((i) => i.status === 'Claimed').length,
    // Count Lost items that are matched (awaiting handover)
    matched: lostItems.filter((i) => i.status === 'Matched').length,
    // Success rate based on Lost items (how many lost items were reunited)
    matchSuccessRate:
      lostItems.length > 0
        ? Math.round(
            (lostItems.filter((i) => i.status === 'Matched' || i.status === 'Claimed').length /
              lostItems.length) *
              100,
          )
        : 0,
  };

  // Calculate score distribution
  const scoreDistribution: ScoreDistribution[] = [
    {
      range: '0-30%',
      count: matches.filter((m) => m.matchScore <= 30).length,
      color: '#ef4444',
    },
    {
      range: '31-50%',
      count: matches.filter((m) => m.matchScore > 30 && m.matchScore <= 50).length,
      color: '#f59e0b',
    },
    {
      range: '51-70%',
      count: matches.filter((m) => m.matchScore > 50 && m.matchScore <= 70).length,
      color: '#3b82f6',
    },
    {
      range: '71-100%',
      count: matches.filter((m) => m.matchScore > 70).length,
      color: '#22c55e',
    },
  ];

  // Calculate trend data based on time range
  const getTrendData = (): TrendData[] => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const result: TrendData[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const day = startOfDay(subDays(new Date(), i));
      const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);

      const count = matches.filter((m) => {
        const matchDate = toDate(m.createdAt);
        if (!matchDate) return false;
        return matchDate >= day && matchDate < dayEnd;
      }).length;

      result.push({
        date: format(day, timeRange === '7d' ? 'EEE' : 'MMM d'),
        matches: count,
      });
    }

    return result;
  };

  // Efficiency data - count only LOST items for success metrics
  // (Lost items get matched/claimed when they are successfully reunited)
  const lostItemsForEfficiency = items.filter((i) => i.type === 'Lost');
  const matchedLostItems = lostItemsForEfficiency.filter(
    (i) => i.status === 'Matched' || i.status === 'Claimed',
  ).length;
  const unmatchedLostItems = lostItemsForEfficiency.filter(
    (i) => i.status !== 'Matched' && i.status !== 'Claimed',
  ).length;

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        {/* Skeleton Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
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
          <h1 className="text-2xl font-bold text-text-primary">Dashboard Overview</h1>
          <p className="text-text-secondary text-sm">
            AI-powered insights for your lost & found system
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">
            Last updated: {format(lastRefresh, 'h:mm:ss a')}
          </span>
          <button
            onClick={() => void fetchData()}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="Refresh data"
          >
            <RefreshCw className="w-5 h-5 text-text-secondary" />
          </button>
        </div>
      </div>

      {/* KPI Cards Row - 3 cols below 1536px, 6 cols above */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-4">
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

      {/* Charts Row 1: Score Distribution + Trend - Stack below 1280px */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MatchScoreChart data={scoreDistribution} />
        <MatchTrendChart data={getTrendData()} timeRange={timeRange} onRangeChange={setTimeRange} />
      </div>

      {/* Charts Row 2: Efficiency + Recent Matches - Stack below 1280px */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <EfficiencyDonut matched={matchedLostItems} unmatched={unmatchedLostItems} />
        <div className="xl:col-span-2">
          <RecentMatchesPanel matches={matches} itemsMap={itemsMap} />
        </div>
      </div>

      {/* Charts Row 3: Handover History */}
      <HandoverTrendChart handovers={handovers} timeRange={timeRange} />

      {/* Item Location Heatmap */}
      <ItemHeatmap radiusKm={2.5} />

      {/* Quick Stats Section */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-text-primary">Quick Statistics</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          <div className="text-center p-4 bg-red-50 rounded-xl">
            <p className="text-2xl font-bold text-red-600">
              {items.filter((i) => i.type === 'Lost').length}
            </p>
            <p className="text-sm text-text-secondary">Lost</p>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-xl">
            <p className="text-2xl font-bold text-blue-600">
              {items.filter((i) => i.type === 'Found').length}
            </p>
            <p className="text-sm text-text-secondary">Found</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-xl">
            <p className="text-2xl font-bold text-green-600">{kpiData.matched}</p>
            <p className="text-sm text-text-secondary">Matched</p>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-xl">
            <p className="text-2xl font-bold text-purple-600">{kpiData.claimed}</p>
            <p className="text-sm text-text-secondary">Claimed</p>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-xl">
            <p className="text-2xl font-bold text-orange-500">{kpiData.pendingReview}</p>
            <p className="text-sm text-text-secondary">Pending</p>
          </div>
        </div>
      </div>
    </div>
  );
}
