/**
 * Applying a transition.
 *
 * One entry point, and everything that changes a handover goes through it:
 * read the current state, ask the table whether the move is legal, and if it
 * is, write the event, the projection and any domain event in a single
 * transaction. Nothing else in the codebase may write `state` on a handover.
 *
 * The single transaction is the point. Section 10.2's complaint about the old
 * completion path was that it was a batch plus three fire-and-forget blocks, so
 * a partial failure left the item statuses, the match record and the credits
 * disagreeing about whether a handover had happened. Here the only thing that
 * has to succeed is the commit; every side effect hangs off the outbox row
 * that commits with it.
 */

import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { db } from '../../utils/firebase-admin.js';
import { outboxRepository, OutboxRepository } from '../../platform/outbox/outbox.repository.js';
import type { OutboxEvent } from '../../platform/outbox/event.catalog.js';
import { createLogger } from '../../utils/logger.js';
import {
  handoverEventRepository,
  HandoverEventRepository,
} from './handover.events.repository.js';
import {
  fromLegacyStatus,
  isHandoverState,
  nextState,
  toLegacyStatus,
  type ActorRole,
  type HandoverState,
  type HandoverTransition,
} from './handover.states.js';

const log = createLogger('handover:machine');

/** Everything one transition needs, once the caller has decided to make it. */
export interface TransitionPlan {
  transition: HandoverTransition;
  actor: string | null;
  actorRole: ActorRole;
  reason?: string | null;
  /** Recorded on the event, never on the projection. */
  metadata?: Record<string, unknown>;
  /** Fields to merge onto the projection in the same commit. */
  patch?: Record<string, unknown>;
  /** A domain event to publish, written in the same commit. */
  publish?: OutboxEvent;
}

export interface TransitionRequest extends TransitionPlan {
  /** The handover is keyed on its match, as the code document always has been. */
  matchId: string;
  /**
   * Refuse unless the current state is one of these.
   *
   * The table already refuses an illegal move. This is for a caller that also
   * cares *which* legal starting point it is moving from: a plain re-trigger
   * of matching may re-issue an open session but must not reopen a cancelled
   * one, and both edges exist.
   */
  expect?: HandoverState[];
}

export type TransitionOutcome =
  | { ok: true; from: HandoverState; to: HandoverState; sequence: number }
  | { ok: false; reason: 'refused'; from: HandoverState };

/**
 * What a caller decided to do, having seen the current document.
 *
 * `result` is the caller's own answer, carried out of the transaction
 * unchanged. Verification needs this: whether a code matched, how many
 * attempts are left and whether the session just blocked are all decided from
 * the same read that the transition is written against, and deciding them
 * beforehand is the read-then-write race that let parallel guesses spend more
 * than the attempt cap (defect LOG-13).
 */
export type Decision<T> =
  | { kind: 'transition'; plan: TransitionPlan; result: T }
  | { kind: 'refuse'; result: T };

export interface DecidedOutcome<T> {
  result: T;
  outcome: TransitionOutcome;
}

/** The state a document with no `state` field is in. */
export function stateOf(data: Record<string, unknown> | undefined): HandoverState {
  if (!data) return 'initiated';
  if (isHandoverState(data.state)) return data.state;

  return fromLegacyStatus(typeof data.status === 'string' ? data.status : undefined);
}

export class HandoverMachine {
  constructor(
    private readonly events: HandoverEventRepository = handoverEventRepository,
    private readonly outbox: OutboxRepository = outboxRepository,
    private readonly firestore = db,
  ) {}

  /**
   * Move one handover, or refuse.
   *
   * A refusal is a return value rather than an exception: "this session is
   * blocked" is an answer the caller shows a user, not a failure of the call.
   */
  async apply(ref: DocumentReference, request: TransitionRequest): Promise<TransitionOutcome> {
    const { matchId, expect, ...plan } = request;

    const decided = await this.decide<null>(ref, matchId, (data, from) => {
      if (expect && !expect.includes(from)) return { kind: 'refuse', result: null };

      return { kind: 'transition', plan, result: null };
    });

    return decided.outcome;
  }

  /**
   * The same, with the caller deciding inside the transaction.
   *
   * The decider sees the stored document and the current state, and answers
   * with the move to make or with a refusal. Everything it returns in `result`
   * comes back to the caller, so a decision and the data it was made from
   * cannot drift apart between the read and the write.
   */
  async decide<T>(
    ref: DocumentReference,
    matchId: string,
    decider: (
      data: Record<string, unknown> | undefined,
      from: HandoverState,
    ) => Decision<T> | Promise<Decision<T>>,
  ): Promise<DecidedOutcome<T>> {
    return this.firestore.runTransaction<DecidedOutcome<T>>(async (tx) => {
      const snapshot = await tx.get(ref);
      const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined;
      const from = stateOf(data);

      const decision = await decider(data, from);

      if (decision.kind === 'refuse') {
        return { result: decision.result, outcome: { ok: false, reason: 'refused', from } };
      }

      const { plan } = decision;
      const to = nextState(from, plan.transition);

      if (!to) {
        log.info('Transition refused by the table', {
          matchId,
          transition: plan.transition,
          from,
        });

        return { result: decision.result, outcome: { ok: false, reason: 'refused', from } };
      }

      // Read from the document rather than counted from the log: a length
      // query inside the transaction would be a second read that says the same
      // thing, and this is the number the deterministic event id is built from.
      const sequence = typeof data?.sequence === 'number' ? data.sequence + 1 : 1;

      this.events.append(tx, {
        handoverId: matchId,
        from: snapshot.exists ? from : null,
        to,
        transition: plan.transition,
        actor: plan.actor,
        actorRole: plan.actorRole,
        reason: plan.reason ?? null,
        metadata: plan.metadata,
        sequence,
      });

      tx.set(
        ref,
        {
          ...(plan.patch ?? {}),
          state: to,
          // Kept in step so that every reader written before the event log —
          // the admin sessions list, the status endpoint, anything reading the
          // collection directly — keeps working without a migration first.
          status: toLegacyStatus(to),
          sequence,
          stateChangedAt: FieldValue.serverTimestamp(),
          ...(snapshot.exists ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      );

      if (plan.publish) this.outbox.appendInTransaction(tx, plan.publish);

      return { result: decision.result, outcome: { ok: true, from, to, sequence } };
    });
  }

  /** The log, for the admin timeline and for a dispute. */
  history(matchId: string) {
    return this.events.list(matchId);
  }
}

export const handoverMachine = new HandoverMachine();
