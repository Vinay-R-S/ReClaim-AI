/**
 * Item persistence.
 *
 * Everything that knows the shape of the `items` collection lives here: no
 * service or route builds a Firestore query of its own. The point is that a
 * query with a subtle rule behind it, such as the moderation filter that has
 * to be applied before `limit` rather than after, is written once.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { collections, db } from '../utils/firebase-admin.js';
import { outboxRepository, OutboxRepository } from '../platform/outbox/outbox.repository.js';
import type { OutboxEvent } from '../platform/outbox/event.catalog.js';
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

/**
 * Vector fields, which are stored on the item and never read with it.
 *
 * They live on the document rather than beside it so that a nearest-neighbour
 * query can filter by type, status and time in the same query it ranks by
 * distance (ADR 0003). The cost of that is this list: every read path in this
 * file spreads the whole document to a caller that ends up serialising it to a
 * browser, and a 384-float vector per item on a list endpoint is kilobytes of
 * nothing anybody asked for. So they come off on the way out, and the one
 * caller that wants them asks for them by name.
 */
const VECTOR_FIELDS = [
  'embedding',
  'imageEmbedding',
  'embeddingKey',
  'embeddingModel',
  'imageEmbeddingModel',
  'embeddedAt',
] as const;

export interface ItemVectors {
  embedding?: Float32Array;
  imageEmbedding?: Float32Array;
  embeddingKey?: string;
  embeddingModel?: string;
  imageEmbeddingModel?: string;
}

export type StoredItemWithVectors = StoredItem & ItemVectors;

/** A Firestore vector value, which reads back as an object, not an array. */
/** An item as callers see it: everything except the vectors. */
function toStoredItem(doc: DocumentSnapshot | QueryDocumentSnapshot): StoredItem {
  const data = { ...doc.data() } as Record<string, unknown>;

  VECTOR_FIELDS.forEach((field) => delete data[field]);

  return { ...(data as unknown as Item), id: doc.id };
}

function toFloat32(value: unknown): Float32Array | undefined {
  if (!value) return undefined;

  const raw =
    typeof (value as { toArray?: () => number[] }).toArray === 'function'
      ? (value as { toArray: () => number[] }).toArray()
      : value;

  return Array.isArray(raw) ? Float32Array.from(raw) : undefined;
}

export class ItemRepository {
  constructor(
    private readonly items = collections.items,
    private readonly firestore = db,
    private readonly outbox: OutboxRepository = outboxRepository,
  ) {}

  async findById(id: string): Promise<StoredItem | null> {
    const doc = await this.items.doc(id).get();

    if (!doc.exists) return null;

    return toStoredItem(doc);
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
    const items = snapshot.docs.map((doc) => toStoredItem(doc));

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
  /**
   * Every report an account has filed.
   *
   * `cap` bounds the read for callers that only want to know roughly how much
   * somebody has filed rather than what. An equality filter takes a limit from
   * the single-field index, so this needs no composite index; the order is
   * unspecified, which is why the only capped caller reports "N or more"
   * rather than a total it cannot stand behind.
   */
  async listAllByReporter(userId: string, cap?: number): Promise<StoredItem[]> {
    const base = this.items.where('reportedBy', '==', userId);
    const snapshot = await (cap ? base.limit(cap) : base).get();

    return snapshot.docs.map((doc) => toStoredItem(doc));
  }

  /** A user's reports, newest first, as the screens list them. */
  async listByReporter(userId: string): Promise<StoredItem[]> {
    const snapshot = await this.items
      .where('reportedBy', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => toStoredItem(doc));
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

    return toStoredItem(created);
  }

  /**
   * Create an item and the events it raises, atomically.
   *
   * The events are built from the new id, which is why the reference is
   * allocated before the commit rather than by `add`. Either the item and its
   * events are both there or neither is, so a matching run can no longer be
   * lost in the gap between saving a report and dispatching the work.
   */
  async createWithEvents(
    data: Record<string, unknown>,
    buildEvents: (itemId: string) => OutboxEvent[],
  ): Promise<StoredItem> {
    const ref = this.items.doc();
    const batch = this.firestore.batch();

    batch.set(ref, {
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    buildEvents(ref.id).forEach((event) => this.outbox.append(batch, event));

    await batch.commit();

    const created = await ref.get();

    return toStoredItem(created);
  }

  /** An edit and the events it raises, atomically. See `createWithEvents`. */
  async updateWithEvents(
    id: string,
    data: Record<string, unknown>,
    events: OutboxEvent[],
  ): Promise<void> {
    const batch = this.firestore.batch();

    batch.update(this.items.doc(id), { ...data, updatedAt: FieldValue.serverTimestamp() });
    events.forEach((event) => this.outbox.append(batch, event));

    await batch.commit();
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

    return snapshot.docs.map((doc) => toStoredItem(doc));
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

    return snapshot.docs.map((doc) => toStoredItem(doc));
  }

  /**
   * An item including its vectors, for the code that actually needs them.
   *
   * Separate from `findById` so that wanting a vector is a deliberate act. The
   * embedding job and the backfill are the only callers today; retrieval joins
   * them in the next phase.
   */
  async findByIdWithVectors(id: string): Promise<StoredItemWithVectors | null> {
    const doc = await this.items.doc(id).get();

    if (!doc.exists) return null;

    const data = doc.data() as Record<string, unknown>;

    return {
      ...toStoredItem(doc),
      embedding: toFloat32(data.embedding),
      imageEmbedding: toFloat32(data.imageEmbedding),
      embeddingKey: typeof data.embeddingKey === 'string' ? data.embeddingKey : undefined,
      embeddingModel: typeof data.embeddingModel === 'string' ? data.embeddingModel : undefined,
      imageEmbeddingModel:
        typeof data.imageEmbeddingModel === 'string' ? data.imageEmbeddingModel : undefined,
    };
  }

  /**
   * Store an item's vectors.
   *
   * As Firestore vector values, not arrays of numbers, because that is the
   * type `findNearest` indexes: storing plain arrays now would mean a full
   * backfill before retrieval could use them (ADR 0003).
   *
   * A `patch`, not an `update`: embedding an item is not an edit its owner
   * made, and stamping `updatedAt` would move every backfilled item to the top
   * of anything sorted by when it was last touched.
   */
  async setEmbeddings(
    id: string,
    vectors: {
      embedding: Float32Array;
      embeddingKey: string;
      embeddingModel: string;
      imageEmbedding?: Float32Array;
      imageEmbeddingModel?: string;
    },
  ): Promise<boolean> {
    const data: Record<string, unknown> = {
      embedding: FieldValue.vector(Array.from(vectors.embedding)),
      embeddingKey: vectors.embeddingKey,
      embeddingModel: vectors.embeddingModel,
      embeddedAt: FieldValue.serverTimestamp(),
    };

    if (vectors.imageEmbedding && vectors.imageEmbeddingModel) {
      data.imageEmbedding = FieldValue.vector(Array.from(vectors.imageEmbedding));
      data.imageEmbeddingModel = vectors.imageEmbeddingModel;
    } else {
      // Cleared, not left. An item whose photo was swapped for one that cannot
      // be read would otherwise keep ranking on the vector of a picture it no
      // longer has.
      data.imageEmbedding = FieldValue.delete();
      data.imageEmbeddingModel = FieldValue.delete();
    }

    try {
      await this.patch(id, data);
    } catch (error) {
      // The job reads the item, then spends up to ten seconds fetching a photo
      // and running inference. An owner deleting their report inside that
      // window is a race, not a failure worth three attempts and a dead letter.
      if ((error as { code?: number }).code === 5) return false;

      throw error;
    }

    return true;
  }

  /**
   * A page of items for the backfill.
   *
   * Ordered by document id and continued by cursor rather than filtered on the
   * absence of a field, because Firestore cannot query for a field that is not
   * there. The caller decides which of these still need work by comparing the
   * stored content hash, which is the same test the job itself applies.
   */
  async pageForEmbedding(
    limit: number,
    after?: string,
  ): Promise<Array<{ id: string; embeddingKey?: string }>> {
    let query = this.items.orderBy('__name__').limit(limit);

    if (after) query = query.startAfter(after);

    const snapshot = await query.get();

    return snapshot.docs.map((doc) => {
      const key = (doc.data() as Record<string, unknown>).embeddingKey;

      return { id: doc.id, embeddingKey: typeof key === 'string' ? key : undefined };
    });
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
