/**
 * Item persistence.
 *
 * Everything that knows the shape of the `items` collection lives here: no
 * service or route builds a Firestore query of its own. The point is that a
 * query with a subtle rule behind it, such as the moderation filter that has
 * to be applied before `limit` rather than after, is written once.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { collections, db } from '../utils/firebase-admin.js';
import type { Item, ItemStatus, ItemType, ModerationStatus } from '../types/index.js';

export interface ItemListFilters {
  type?: ItemType;
  status?: ItemStatus;
  moderation?: ModerationStatus;
  reportedBy?: string;
  limit: number;
  /** Id of the last item on the previous page. */
  cursor?: string;
}

export type StoredItem = Item & { id: string };

export class ItemRepository {
  constructor(
    private readonly items = collections.items,
    private readonly firestore = db,
  ) {}

  async findById(id: string): Promise<StoredItem | null> {
    const doc = await this.items.doc(id).get();

    if (!doc.exists) return null;

    return { ...(doc.data() as Item), id: doc.id };
  }

  /**
   * A page of items.
   *
   * An explicit moderation filter is a real query filter, applied before the
   * page is taken. Applied after `limit` it silently returned an empty review
   * queue whenever the newest page happened to be all approved. Dropping
   * `orderBy` for that case keeps the query to equality filters, which
   * Firestore serves from single-field indexes; the caller sorts the page.
   */
  async list(
    filters: ItemListFilters,
  ): Promise<{ items: StoredItem[]; sortedByQuery: boolean; nextCursor: string | null }> {
    const filterModeration = Boolean(filters.moderation);

    let query = filterModeration
      ? this.items.where('moderation', '==', filters.moderation)
      : this.items.orderBy('createdAt', 'desc');

    if (filters.type) query = query.where('type', '==', filters.type);
    if (filters.status) query = query.where('status', '==', filters.status);
    if (filters.reportedBy) query = query.where('reportedBy', '==', filters.reportedBy);

    // A cursor only means anything against an ordered query. The
    // moderation-filtered branch is sorted after the fetch, so it has no stable
    // page boundary to resume from.
    if (!filterModeration && filters.cursor) {
      const anchor = await this.items.doc(filters.cursor).get();

      // The anchor was deleted between pages. Ignoring it would restart the
      // query at page one and hand back the same cursor, which is a caller
      // that walks the first page until it hits its own page cap.
      if (!anchor.exists) {
        return { items: [], sortedByQuery: true, nextCursor: null };
      }

      query = query.startAfter(anchor);
    }

    const snapshot = await (filterModeration ? query.get() : query.limit(filters.limit).get());
    const items = snapshot.docs.map((doc) => ({ ...(doc.data() as Item), id: doc.id }));

    // A full page means there may be another; a short one is the end.
    const nextCursor =
      !filterModeration && items.length === filters.limit
        ? (items[items.length - 1]?.id ?? null)
        : null;

    return { items, sortedByQuery: !filterModeration, nextCursor };
  }

  /**
   * Every item a user reported, in no particular order.
   *
   * Separate from `listByReporter` on purpose: an ordered query omits documents
   * that are missing the sort field, so a count rebuilt from `orderBy('createdAt')`
   * would silently exclude legacy items written before that field existed and
   * persist a wrong total, which is the opposite of what a repair is for.
   */
  async listAllByReporter(userId: string): Promise<StoredItem[]> {
    const snapshot = await this.items.where('reportedBy', '==', userId).get();

    return snapshot.docs.map((doc) => ({ ...(doc.data() as Item), id: doc.id }));
  }

  /** A user's reports, newest first, as the screens list them. */
  async listByReporter(userId: string): Promise<StoredItem[]> {
    const snapshot = await this.items
      .where('reportedBy', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({ ...(doc.data() as Item), id: doc.id }));
  }

  /**
   * Write a new item and read it back.
   *
   * The document is read back rather than echoed, because the written object
   * still holds unresolved `serverTimestamp()` sentinels, which serialise to
   * `{}` and give any client rendering `createdAt` an invalid date.
   */
  async create(data: Record<string, unknown>): Promise<StoredItem> {
    const ref = await this.items.add({
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const created = await ref.get();

    return { ...(created.data() as Item), id: created.id };
  }

  /** Every write stamps `updatedAt`; no caller has to remember to. */
  async update(id: string, data: Record<string, unknown>): Promise<void> {
    await this.items.doc(id).update({ ...data, updatedAt: FieldValue.serverTimestamp() });
  }

  /**
   * A write that is not an edit, so it leaves `updatedAt` alone.
   *
   * A background scoring pass that found nothing is not a change the owner
   * made, and stamping it would move the item to the top of anything sorted by
   * when it was last touched.
   */
  async patch(id: string, data: Record<string, unknown>): Promise<void> {
    await this.items.doc(id).update(data);
  }

  async updateAndFetch(id: string, data: Record<string, unknown>): Promise<StoredItem | null> {
    await this.update(id, data);

    return this.findById(id);
  }

  /** Apply the same patch to several items at once. */
  async updateMany(ids: string[], data: Record<string, unknown>): Promise<void> {
    await Promise.all(ids.map((id) => this.update(id, data)));
  }

  async listByReporterAndType(userId: string, type: ItemType): Promise<StoredItem[]> {
    const snapshot = await this.items
      .where('reportedBy', '==', userId)
      .where('type', '==', type)
      .get();

    return snapshot.docs.map((doc) => ({ ...(doc.data() as Item), id: doc.id }));
  }

  /**
   * Matching candidates: pending items of the given type.
   *
   * Moderation is deliberately not a `where` clause. An item created before
   * moderation existed has no such field, so an equality filter would exclude
   * the entire existing corpus until the migration ran and matching would
   * quietly return nothing. The caller treats a missing field as approved.
   */
  async listPendingByType(type: ItemType): Promise<StoredItem[]> {
    const snapshot = await this.items
      .where('type', '==', type)
      .where('status', '==', 'Pending')
      .get();

    return snapshot.docs.map((doc) => ({ ...(doc.data() as Item), id: doc.id }));
  }

  async exists(id: string): Promise<boolean> {
    const doc = await this.items.doc(id).get();

    return doc.exists;
  }

  async delete(id: string): Promise<void> {
    await this.items.doc(id).delete();
  }

  /**
   * Claim the right to run matching for an item.
   *
   * Transactional, because creation, approval and the manual rematch all
   * dispatch a detached pipeline with nothing recording that one is already in
   * flight. Two admins acting at once, or an approval followed straight away
   * by a rematch, would score the same item twice, and each run can cross the
   * threshold against a different counterpart and open its own handover for
   * one report. A run whose process dies without releasing the claim is taken
   * over after `ttlMs` rather than blocking the item forever.
   */
  async claimMatchingRun(id: string, ttlMs: number): Promise<boolean> {
    const ref = this.items.doc(id);

    return this.firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);

      if (!snapshot.exists) return false;

      const startedAt = snapshot.data()?.matchingStartedAt as Timestamp | undefined;

      if (startedAt && Date.now() - startedAt.toMillis() < ttlMs) return false;

      tx.update(ref, { matchingStartedAt: Timestamp.now() });

      return true;
    });
  }

  async releaseMatchingRun(id: string): Promise<void> {
    await this.items.doc(id).update({ matchingStartedAt: FieldValue.delete() });
  }
}

export const itemRepository = new ItemRepository();
