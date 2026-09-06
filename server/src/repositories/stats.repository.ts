/**
 * Aggregate reads for the admin dashboard.
 *
 * The dashboard used to pull every item, every match and every handover into
 * the browser and count them there, every thirty seconds (defect PERF-07). The
 * counts are Firestore aggregation queries here, which return a number without
 * reading a single document; only the collections the charts actually plot are
 * read in full, and they are the small ones.
 */

import { collections } from '../utils/firebase-admin.js';
import type { ItemStatus, ItemType } from '../types/index.js';

export interface ItemSummary {
  id: string;
  name: string;
  type: ItemType;
  status: ItemStatus;
  location: string;
  lat?: number;
  lng?: number;
}

export interface ItemCounts {
  total: number;
  lostTotal: number;
  foundTotal: number;
  lostPending: number;
  foundPending: number;
  lostMatched: number;
  lostClaimed: number;
  pendingReview: number;
  awaitingModeration: number;
}

export class StatsRepository {
  constructor(
    private readonly items = collections.items,
    private readonly matches = collections.matches,
    private readonly matchHistory = collections.matchHistory,
    private readonly handovers = collections.handovers,
  ) {}

  private async count(query: FirebaseFirestore.Query): Promise<number> {
    const snapshot = await query.count().get();

    return snapshot.data().count;
  }

  private byTypeAndStatus(type: ItemType, status: ItemStatus): FirebaseFirestore.Query {
    return this.items.where('type', '==', type).where('status', '==', status);
  }

  /**
   * Every number the KPI row shows, as nine aggregation queries.
   *
   * Claimed and Matched count Lost items only: owners claim and finders hand
   * over, so counting both sides would double every reunion.
   */
  async itemCounts(): Promise<ItemCounts> {
    const [
      total,
      lostTotal,
      foundTotal,
      lostPending,
      foundPending,
      lostMatched,
      lostClaimed,
      pendingReview,
      awaitingModeration,
    ] = await Promise.all([
      this.count(this.items),
      this.count(this.items.where('type', '==', 'Lost')),
      this.count(this.items.where('type', '==', 'Found')),
      this.count(this.byTypeAndStatus('Lost', 'Pending')),
      this.count(this.byTypeAndStatus('Found', 'Pending')),
      this.count(this.byTypeAndStatus('Lost', 'Matched')),
      this.count(this.byTypeAndStatus('Lost', 'Claimed')),
      this.count(this.items.where('status', '==', 'Pending')),
      this.count(this.items.where('moderation', '==', 'pending')),
    ]);

    return {
      total,
      lostTotal,
      foundTotal,
      lostPending,
      foundPending,
      lostMatched,
      lostClaimed,
      pendingReview,
      awaitingModeration,
    };
  }

  /**
   * Live and archived matches together.
   *
   * A completed handover moves its match to `matchHistory` and deletes it from
   * `matches`, so counting the live collection alone would drop every match
   * that actually worked: the total, the trend and the score distribution
   * would all describe the failures and none of the successes.
   */
  async matchCount(): Promise<number> {
    const [live, archived] = await Promise.all([
      this.count(this.matches),
      this.count(this.matchHistory),
    ]);

    return live + archived;
  }

  /** The newest matches from both collections, for the distribution and trend. */
  async recentMatches(limit: number): Promise<FirebaseFirestore.DocumentData[]> {
    const [live, archived] = await Promise.all([
      this.matches.orderBy('createdAt', 'desc').limit(limit).get(),
      this.matchHistory.orderBy('createdAt', 'desc').limit(limit).get(),
    ]);

    return [...live.docs, ...archived.docs].map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  async handoverCount(): Promise<number> {
    return this.count(this.handovers);
  }

  async recentHandovers(limit: number): Promise<FirebaseFirestore.DocumentData[]> {
    const snapshot = await this.handovers.orderBy('handoverTime', 'desc').limit(limit).get();

    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  /** The specific items a set of matches refers to, by id. */
  async itemsByIds(ids: string[]): Promise<Map<string, { name: string }>> {
    if (ids.length === 0) return new Map();

    const refs = ids.map((id) => this.items.doc(id));
    const docs = await this.items.firestore.getAll(...refs, { fieldMask: ['name'] });

    return new Map(
      docs
        .filter((doc) => doc.exists)
        .map((doc) => [doc.id, { name: (doc.data()?.name as string) ?? 'Unknown Item' }]),
    );
  }

  /**
   * Just enough of an item to draw it: the heatmap needs coordinates and the
   * recent-matches panel needs names, and neither needs the description, the
   * tags or the reporter's email.
   */
  async itemSummaries(limit: number): Promise<ItemSummary[]> {
    const snapshot = await this.items
      .select('name', 'type', 'status', 'location', 'coordinates')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as {
        name?: string;
        type?: ItemType;
        status?: ItemStatus;
        location?: string;
        coordinates?: { lat?: number; lng?: number };
      };

      return {
        id: doc.id,
        name: data.name ?? 'Unknown Item',
        type: data.type ?? 'Lost',
        status: data.status ?? 'Pending',
        location: data.location ?? '',
        lat: data.coordinates?.lat,
        lng: data.coordinates?.lng,
      };
    });
  }
}

export const statsRepository = new StatsRepository();
