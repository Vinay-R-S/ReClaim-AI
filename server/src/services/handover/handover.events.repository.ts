/**
 * The handover event log.
 *
 * Append-only. Nothing here updates or deletes a row, and that is the property
 * the rest of section 10 is built on: a dispute is resolvable because the log
 * says who did what and when, and a revert is safe because the prior state is
 * still readable rather than overwritten.
 *
 * The log lives beside the projection rather than replacing it. Rebuilding
 * state by reading every event on every request would be a query per read for
 * a value that changes a handful of times in a session's life, so the current
 * state is materialised onto `handoverCodes/{matchId}` in the same transaction
 * that appends the event. The log is the source of truth; the projection is a
 * cache of its last entry that happens to be what every existing reader
 * already reads.
 */

import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { currentTraceparent } from '../../platform/tracing/context.js';
import type { ActorRole, HandoverState, HandoverTransition } from './handover.states.js';

export interface HandoverEventInput {
  handoverId: string;
  from: HandoverState | null;
  to: HandoverState;
  transition: HandoverTransition;
  actor: string | null;
  actorRole: ActorRole;
  reason: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Position in this handover's log.
   *
   * Not a timestamp. Two events written in the same millisecond are ordered
   * arbitrarily by `at`, and a projection folded in the wrong order reports a
   * state the machine never reached.
   */
  sequence: number;
}

export interface StoredHandoverEvent extends Omit<HandoverEventInput, 'metadata'> {
  id: string;
  metadata: Record<string, unknown>;
  at: Date | null;
}

export class HandoverEventRepository {
  constructor(private readonly events = collections.handoverEvents) {}

  /**
   * Append one event inside the caller's transaction.
   *
   * The id is deterministic, `{handoverId}:{sequence}`, so a transaction that
   * Firestore retries cannot leave two rows for one transition: the retry
   * addresses the same document. A genuine second transition reads the new
   * sequence and lands elsewhere.
   *
   * `create`, not `set`. Determinism only protects against Firestore retrying
   * the same transition; append-only actually rests on `sequence` in the
   * projection being monotone, which is the cache the log is supposed to be
   * the source of truth for. A sequence reset — a bad repair, a migration
   * racing a live transition — would otherwise overwrite an existing event
   * with a different `from` and `to`, silently, destroying the evidence a
   * dispute is resolved from. `create` aborts the whole transaction instead.
   */
  append(tx: Transaction, event: HandoverEventInput): string {
    const id = `${event.handoverId}:${event.sequence}`;

    tx.create(this.events.doc(id), {
      handoverId: event.handoverId,
      from: event.from,
      to: event.to,
      transition: event.transition,
      actor: event.actor,
      actorRole: event.actorRole,
      reason: event.reason,
      metadata: event.metadata ?? {},
      sequence: event.sequence,
      traceparent: currentTraceparent(),
      at: FieldValue.serverTimestamp(),
    });

    return id;
  }

  /** The whole log for one handover, oldest first. */
  async list(handoverId: string): Promise<StoredHandoverEvent[]> {
    const snapshot = await this.events
      .where('handoverId', '==', handoverId)
      .orderBy('sequence', 'asc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as Omit<StoredHandoverEvent, 'id' | 'at'> & { at?: Timestamp };

      return {
        ...data,
        metadata: data.metadata ?? {},
        id: doc.id,
        at: data.at?.toDate() ?? null,
      };
    });
  }
}

export const handoverEventRepository = new HandoverEventRepository();
