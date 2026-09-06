/**
 * The admin dashboard, computed server side.
 *
 * One request replaces three full-collection reads in the browser, repeated
 * every thirty seconds (defect PERF-07).
 */

import { StatsRepository, statsRepository } from '../repositories/stats.repository.js';
import { SettingsRepository, settingsRepository } from '../repositories/settings.repository.js';
import type { ItemType } from '../types/index.js';
import type { DashboardStats } from '../../../shared/domain.js';

export type { DashboardStats };

/**
 * How much of each collection the charts look at.
 *
 * The trends cover ninety days and the distribution is a shape rather than a
 * census, so a bounded window of the newest records answers both without the
 * cost growing with the project.
 */
const MATCH_WINDOW = 500;
const HANDOVER_WINDOW = 500;
/**
 * How many items the heatmap plots.
 *
 * A cap rather than the whole collection, and the newest are the ones worth
 * seeing on a map; the count under the map says how many are drawn.
 */
const ITEM_SUMMARY_WINDOW = 1000;
const RECENT_MATCHES = 10;

/** The trend the dashboard can ask for, in days. */
const TREND_DAYS = 90;

/** A Firestore timestamp, a Date, or whatever survived JSON. */
function toDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) return value;

  const candidate = value as { toDate?: () => Date; _seconds?: number; seconds?: number };

  if (typeof candidate.toDate === 'function') return candidate.toDate();

  const seconds = candidate._seconds ?? candidate.seconds;

  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

/**
 * The UTC calendar day a moment falls in.
 *
 * UTC on both sides on purpose. Keying the buckets from local midnight while
 * formatting the key with `toISOString()` put the newest bucket on yesterday's
 * UTC date for any server east of UTC, so everything created today keyed to a
 * bucket that did not exist and was silently dropped.
 */
function dayKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/** An empty bucket per day, so a day with nothing still plots as zero. */
function emptyDays(days: number): Map<string, number> {
  const buckets = new Map<string, number>();
  const today = new Date();
  const midnightUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  for (let back = days - 1; back >= 0; back -= 1) {
    buckets.set(dayKey(new Date(midnightUtc - back * 24 * 60 * 60 * 1000)), 0);
  }

  return buckets;
}

function bucketByDay(
  records: FirebaseFirestore.DocumentData[],
  field: string,
  days: number,
): Map<string, number> {
  const buckets = emptyDays(days);

  for (const record of records) {
    const when = toDate(record[field]);

    if (!when) continue;

    const key = dayKey(when);

    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return buckets;
}

export class StatsService {
  constructor(
    private readonly stats: StatsRepository = statsRepository,
    private readonly settings: SettingsRepository = settingsRepository,
  ) {}

  async dashboard(): Promise<DashboardStats> {
    const [counts, totalMatches, totalHandovers, matches, handovers, items, settings] =
      await Promise.all([
        this.stats.itemCounts(),
        this.stats.matchCount(),
        this.stats.handoverCount(),
        this.stats.recentMatches(MATCH_WINDOW),
        this.stats.recentHandovers(HANDOVER_WINDOW),
        this.stats.itemSummaries(ITEM_SUMMARY_WINDOW),
        this.settings.getSystem(),
      ]);

    const recent = matches
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0))
      .slice(0, RECENT_MATCHES);

    // The names for the recent panel are read by id rather than looked up in
    // the item window: a recent match against an older report would otherwise
    // resolve to "Unknown Item" purely because the item fell outside it.
    const namedItems = await this.stats.itemsByIds(
      [
        ...new Set(
          recent.flatMap((match) => [match.lostItemId as string, match.foundItemId as string]),
        ).values(),
      ].filter(Boolean),
    );

    // Reunited over reported, counted on the Lost side only: an owner claims
    // and a finder hands over, so counting both would double every reunion.
    const reunited = counts.lostMatched + counts.lostClaimed;
    const matchSuccessRate =
      counts.lostTotal > 0 ? Math.round((reunited / counts.lostTotal) * 100) : 0;

    const matchTrend = [...bucketByDay(matches, 'createdAt', TREND_DAYS)].map(([date, count]) => ({
      date,
      matches: count,
    }));
    const handoverTrend = [...bucketByDay(handovers, 'handoverTime', TREND_DAYS)].map(
      ([date, count]) => ({ date, handovers: count }),
    );

    return {
      kpis: {
        totalItems: counts.total,
        lostTotal: counts.lostTotal,
        foundTotal: counts.foundTotal,
        activeLost: counts.lostPending,
        activeFound: counts.foundPending,
        totalMatches,
        pendingReview: counts.pendingReview,
        claimed: counts.lostClaimed,
        matched: counts.lostMatched,
        matchSuccessRate,
      },
      scoreDistribution: scoreBands(matches),
      matchTrend,
      handoverTrend,
      efficiency: {
        matched: reunited,
        unmatched: counts.lostTotal - reunited,
      },
      recentMatches: recent.map((match) => ({
        id: match.id as string,
        matchScore: (match.matchScore as number) ?? 0,
        lostItemName: namedItems.get(match.lostItemId as string)?.name ?? 'Unknown Item',
        foundItemName: namedItems.get(match.foundItemId as string)?.name ?? 'Unknown Item',
        createdAt: toDate(match.createdAt)?.toISOString() ?? null,
      })),
      heatmapPoints: items
        .filter(
          (item): item is typeof item & { lat: number; lng: number } =>
            typeof item.lat === 'number' && typeof item.lng === 'number',
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          status: item.status,
          location: item.location,
          lat: item.lat,
          lng: item.lng,
        })),
      totalHandovers,
      mapCenter: settings?.mapCenter as DashboardStats['mapCenter'],
      generatedAt: new Date().toISOString(),
    };
  }
}

function scoreBands(matches: FirebaseFirestore.DocumentData[]) {
  const bands = [
    { range: '0-30%', test: (score: number) => score <= 30 },
    { range: '31-50%', test: (score: number) => score > 30 && score <= 50 },
    { range: '51-70%', test: (score: number) => score > 50 && score <= 70 },
    { range: '71-100%', test: (score: number) => score > 70 },
  ];

  return bands.map(({ range, test }) => ({
    range,
    count: matches.filter((match) => test((match.matchScore as number) ?? 0)).length,
  }));
}

export const statsService = new StatsService();
