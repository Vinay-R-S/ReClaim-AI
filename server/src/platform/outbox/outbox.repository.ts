/**
 * The transactional outbox.
 *
 * A side effect that runs inline after a commit is lost whenever the process
 * dies between the two, which is how a report could be saved with no matching
 * run ever started. Instead the event is written in the same atomic commit as
 * the state change, and a drainer publishes it afterwards. The commit is the
 * only thing that has to succeed for the work to be guaranteed.
 */

import { FieldValue, Timestamp, type Transaction, type WriteBatch } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { currentTraceparent } from '../tracing/context.js';
import { EVENT_VERSIONS, type OutboxEvent, type OutboxEventName } from './event.catalog.js';

export type OutboxStatus = 'pending' | 'published' | 'dead';

export interface OutboxRecord {
  id: string;
  name: OutboxEventName;
  version: number;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  /** Not eligible for publication before this. Backoff moves it forward. */
  availableAt: Timestamp;
  leaseExpiresAt: Timestamp | null;
  traceparent: string;
  lastError?: string;
}

export class OutboxRepository {
  constructor(private readonly outbox = collections.outbox) {}

  /**
   * Add an event to a batch the caller is already building.
   *
   * The point of taking the batch rather than owning it: the event and the
   * write it describes commit together or not at all.
   */
  append(batch: WriteBatch, event: OutboxEvent): string {
    const ref = this.outbox.doc();

    batch.set(ref, {
      name: event.name,
      version: EVENT_VERSIONS[event.name],
      payload: event.payload,
      status: 'pending',
      attempts: 0,
      availableAt: Timestamp.now(),
      leaseExpiresAt: null,
      traceparent: currentTraceparent(),
      createdAt: FieldValue.serverTimestamp(),
    });

    return ref.id;
  }

  /**
   * The same, inside a transaction the caller is already running.
   *
   * A batch cannot read, and a state transition has to read the current state
   * before it may write the next one, so the handover machine runs in a
   * transaction rather than a batch. The guarantee is the one that matters
   * either way: the event and the state change it describes commit together.
   */
  appendInTransaction(tx: Transaction, event: OutboxEvent): string {
    const ref = this.outbox.doc();

    tx.set(ref, {
      name: event.name,
      version: EVENT_VERSIONS[event.name],
      payload: event.payload,
      status: 'pending',
      attempts: 0,
      availableAt: Timestamp.now(),
      leaseExpiresAt: null,
      traceparent: currentTraceparent(),
      createdAt: FieldValue.serverTimestamp(),
    });

    return ref.id;
  }

  /** Events due for publication, oldest first. */
  async listDue(limit: number): Promise<OutboxRecord[]> {
    const snapshot = await this.outbox
      .where('status', '==', 'pending')
      .where('availableAt', '<=', Timestamp.now())
      .orderBy('availableAt', 'asc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      ...(doc.data() as Omit<OutboxRecord, 'id'>),
      id: doc.id,
    }));
  }

  /**
   * Take exclusive ownership of one event for `leaseMs`.
   *
   * Two drainers is the normal case once there is more than one worker, so the
   * decision has to be transactional. A drainer that dies holding a lease
   * loses it by expiry.
   */
  async lease(id: string, leaseMs: number): Promise<boolean> {
    const ref = this.outbox.doc(id);
    const now = Date.now();

    return this.outbox.firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);

      if (!snapshot.exists) return false;

      const record = snapshot.data() as OutboxRecord;

      if (record.status !== 'pending') return false;
      if (record.availableAt.toMillis() > now) return false;
      if (record.leaseExpiresAt && record.leaseExpiresAt.toMillis() > now) return false;

      tx.update(ref, { leaseExpiresAt: Timestamp.fromMillis(now + leaseMs) });

      return true;
    });
  }

  async markPublished(id: string): Promise<void> {
    await this.outbox.doc(id).update({
      status: 'published',
      leaseExpiresAt: null,
      publishedAt: FieldValue.serverTimestamp(),
    });
  }

  /** Publication failed. Back off and let another pass pick it up. */
  async markFailed(id: string, attempts: number, availableAt: Date, error: string): Promise<void> {
    await this.outbox.doc(id).update({
      attempts,
      availableAt: Timestamp.fromDate(availableAt),
      leaseExpiresAt: null,
      lastError: error,
    });
  }

  /** Out of attempts. It stays in the collection so it can be found and fixed. */
  async markDead(id: string, attempts: number, error: string): Promise<void> {
    await this.outbox.doc(id).update({
      status: 'dead',
      attempts,
      leaseExpiresAt: null,
      lastError: error,
      deadAt: FieldValue.serverTimestamp(),
    });
  }
}

export const outboxRepository = new OutboxRepository();
