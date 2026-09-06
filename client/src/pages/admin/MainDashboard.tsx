/**
 * The admin dashboard.
 *
 * Data in, layout out. The KPI cards, the four charts and the recent-matches
 * panel are in `components/admin/dashboard`; what is left here is which
 * numbers they are given.
 */

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
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
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { fromDayKey } from '@/lib/timestamps';
import { Feedback } from '@/components/ui/Feedback';
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

/** How often the dashboard asks the server for a fresh set of numbers. */
const REFRESH_INTERVAL_MS = 30000;

/** The colour each score band is drawn in. */
const BAND_COLOURS: Record<string, string> = {
  '0-30%': '#ef4444',
  '31-50%': '#f59e0b',
  '51-70%': '#3b82f6',
  '71-100%': '#22c55e',
};

/** What the KPI row shows before the first response arrives. */
const EMPTY_KPIS: KPIData = {
  totalItems: 0,
  lostTotal: 0,
  foundTotal: 0,
  activeLost: 0,
  activeFound: 0,
  totalMatches: 0,
  pendingReview: 0,
  claimed: 0,
  matched: 0,
  matchSuccessRate: 0,
};

export function MainDashboard() {
  const { stats, loading, error, reload } = useDashboardStats();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');

  const fetchData = useCallback(
    async ({ silent = false } = {}) => {
      await reload({ silent });
      setLastRefresh(new Date());
    },
    [reload],
  );

  useEffect(() => {
    // Silent: replacing every chart with a skeleton twice a minute is not a
    // refresh anyone asked for.
    const interval = setInterval(() => {
      void fetchData({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchData]);

  const kpiData: KPIData = stats?.kpis ?? EMPTY_KPIS;

  const scoreDistribution: ScoreDistribution[] = (stats?.scoreDistribution ?? []).map((band) => ({
    ...band,
    color: BAND_COLOURS[band.range] ?? '#94a3b8',
  }));

  /**
   * The trend, cut to the range the admin picked.
   *
   * The server sends ninety days once; switching between 7, 30 and all is a
   * slice rather than another request.
   */
  const getTrendData = (): TrendData[] => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const series = stats?.matchTrend ?? [];

    return series.slice(-days).map((point) => ({
      date: format(fromDayKey(point.date), timeRange === '7d' ? 'EEE' : 'MMM d'),
      matches: point.matches,
    }));
  };

  const matchedLostItems = stats?.efficiency.matched ?? 0;
  const unmatchedLostItems = stats?.efficiency.unmatched ?? 0;

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

  if (error && !stats) {
    return (
      <div className="space-y-6">
        <Feedback
          tone="error"
          message="Could not load the dashboard. The numbers below would be zeros rather than an empty project, so nothing is shown."
        />
        <button
          onClick={() => void fetchData()}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
        >
          Try again
        </button>
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
          <RecentMatchesPanel matches={stats?.recentMatches ?? []} />
        </div>
      </div>

      {/* Charts Row 3: Handover History */}
      <HandoverTrendChart
        trend={stats?.handoverTrend ?? []}
        total={stats?.totalHandovers ?? 0}
        timeRange={timeRange}
      />

      {/* Item Location Heatmap */}
      <ItemHeatmap
        radiusKm={2.5}
        loading={loading}
        points={stats?.heatmapPoints ?? []}
        mapCenter={stats?.mapCenter}
      />

      {/* Quick Stats Section */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-text-primary">Quick Statistics</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          <div className="text-center p-4 bg-red-50 rounded-xl">
            <p className="text-2xl font-bold text-red-600">{kpiData.lostTotal}</p>
            <p className="text-sm text-text-secondary">Lost</p>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-xl">
            <p className="text-2xl font-bold text-blue-600">{kpiData.foundTotal}</p>
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
