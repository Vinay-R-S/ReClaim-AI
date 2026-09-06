/**
 * The dashboard charts.
 *
 * Recharts wiring only: each one takes the series it draws and knows nothing
 * about where the numbers came from.
 */

import { format, startOfDay, subDays } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, CheckCircle, Package, Search, TrendingUp, Zap } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { toDate } from '@/lib/timestamps';
import type { HandoverRecord, Item, Match } from '@/types/domain';
import type { ScoreDistribution, TrendData } from './DashboardCards';

interface MatchScoreChartProps {
  data: ScoreDistribution[];
}

export function MatchScoreChart({ data }: MatchScoreChartProps) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-text-primary">Match Score Distribution</h3>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="range" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              borderRadius: '12px',
              border: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
            formatter={(value: any) => [`${value} matches`, 'Count']}
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
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
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
  timeRange: '7d' | '30d' | 'all';
  onRangeChange: (range: '7d' | '30d' | 'all') => void;
}

export function MatchTrendChart({ data, timeRange, onRangeChange }: MatchTrendChartProps) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-text-primary">Matches Over Time</h3>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['7d', '30d', 'all'] as const).map((range) => (
            <button
              key={range}
              onClick={() => onRangeChange(range)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                timeRange === range
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              borderRadius: '12px',
              border: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
          />
          <Line
            type="monotone"
            dataKey="matches"
            stroke="#4285f4"
            strokeWidth={3}
            dot={{ fill: '#4285f4', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: '#4285f4' }}
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

export function EfficiencyDonut({ matched, unmatched }: EfficiencyDonutProps) {
  const total = matched + unmatched;
  const efficiency = total > 0 ? Math.round((matched / total) * 100) : 0;

  const data = [
    { name: 'Matched', value: matched, color: '#22c55e' },
    { name: 'Unmatched', value: unmatched, color: '#e5e7eb' },
  ];

  return (
    <div
      className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm h-full"
      style={{ minHeight: '340px' }}
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
                borderRadius: '12px',
                border: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>

        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center -mt-4">
            <p className="text-3xl font-bold text-text-primary">{efficiency}%</p>
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

export function RecentMatchesPanel({ matches, itemsMap }: RecentMatchesPanelProps) {
  const recentMatches = matches.slice(0, 3); // Show only 3 recent matches

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-blue-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const formatMatchDate = (createdAt: unknown) => {
    if (!createdAt) return 'N/A';
    const ts = createdAt as { _seconds?: number; seconds?: number };
    const secs = ts._seconds ?? ts.seconds;
    if (secs) return format(new Date(secs * 1000), 'MMM d, h:mm a');
    return 'N/A';
  };

  return (
    <div
      className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm h-full"
      style={{ minHeight: '340px' }}
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
                      alt={lostItem?.name || 'Lost Item'}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center text-lg">
                      <Search className="w-5 h-5 text-red-500" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {lostItem?.name || 'Unknown'}
                    </p>
                    <p className="text-xs text-red-500">Lost</p>
                  </div>
                </div>

                {/* Arrow + Score */}
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={cn(
                      'px-2 py-0.5 rounded-full text-white text-xs font-bold',
                      getScoreColor(match.matchScore),
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
                      alt={foundItem?.name || 'Found Item'}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-lg">
                      <Package className="w-5 h-5 text-green-500" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {foundItem?.name || 'Unknown'}
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
  timeRange: '7d' | '30d' | 'all';
}

export function HandoverTrendChart({ handovers, timeRange }: HandoverTrendChartProps) {
  // Calculate trend data based on time range
  const getTrendData = () => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const result: { date: string; handovers: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const day = startOfDay(subDays(new Date(), i));
      const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);

      const count = handovers.filter((h) => {
        const handoverDate = toDate(h.handoverTime);
        if (!handoverDate) return false;
        return handoverDate >= day && handoverDate < dayEnd;
      }).length;

      result.push({
        date: format(day, timeRange === '7d' ? 'EEE' : 'MMM d'),
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
        <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 12 }} domain={[0, 5]} allowDecimals={false} tickCount={6} />
          <Tooltip
            contentStyle={{
              borderRadius: '12px',
              border: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
            formatter={(value: any) => [`${value} handovers`, 'Completed']}
          />
          <Bar dataKey="handovers" fill="#22c55e" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
