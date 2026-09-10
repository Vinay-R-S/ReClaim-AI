/**
 * The handover state machine (PLAN.md section 10.1).
 *
 * The old flow kept a `status` field and mutated it. That works while nothing
 * goes wrong and corrupts state when anything does, because a field mutation
 * carries no answer to "how did it get here": a re-trigger could put a blocked
 * session back to pending and nothing recorded that it had ever been blocked
 * (defect LOG-11). It was fixed by adding a guard to the one code path that
 * did it, which is a fix that has to be repeated for every path added later.
 *
 * Here the transition table is the guard. A move that is not in it does not
 * happen, wherever it is attempted from, and every move that does happen is a
 * persisted event rather than an overwrite. Current state is a projection of
 * that log, which gives the audit trail, the dispute evidence and the safe
 * revert for free rather than as three more features.
 *
 * This file is pure on purpose: no Firestore, no clock, no config. It is the
 * part that has to be right, so it is the part that can be exhaustively tested
 * without booting anything.
 */

/**
 * Every state a handover can be in.
 *
 * `code_issued` is what the old vocabulary called `pending`. The rename is
 * worth the migration: `pending` described the code document, and half the
 * states below are not about a code at all.
 */
export const HANDOVER_STATES = [
  'initiated',
  'code_issued',
  'awaiting_meet',
  'verified',
  'completed',
  'blocked',
  'expired',
  'cancelled',
  'disputed',
  'reverted',
] as const;

export type HandoverState = (typeof HANDOVER_STATES)[number];

/**
 * What caused a transition.
 *
 * Named for the event rather than the resulting state, because two different
 * causes can lead to the same state and a log that records only the state
 * cannot tell them apart. `expire` and `cancel` both end a live session; only
 * one of them is somebody's decision.
 */
export const HANDOVER_TRANSITIONS = [
  'issue_code',
  'reissue_code',
  'present_code',
  'confirm_receipt',
  'complete',
  'fail_attempt',
  'block',
  'expire',
  'cancel',
  'dispute',
  'revert',
] as const;

export type HandoverTransition = (typeof HANDOVER_TRANSITIONS)[number];

/** Who asked for a transition. `system` is the pipeline or a worker. */
export type ActorRole = 'system' | 'owner' | 'finder' | 'admin';

/**
 * The table. Everything not listed here is refused.
 *
 * Two rules are load-bearing and both are absences rather than entries:
 *
 * `blocked` has no edge back to `code_issued` under `issue_code`. Only an
 * admin `reissue_code` reopens it, which is LOG-11 made structural: no future
 * caller can reopen a blocked session by accident, because there is no edge to
 * take.
 *
 * `completed` has no edge to anything except `disputed` and `reverted`. A
 * completed handover is a fact about the physical world; the only honest moves
 * from it are to challenge it or to compensate for it, never to quietly
 * rewind it.
 */
const TABLE: Record<HandoverState, Partial<Record<HandoverTransition, HandoverState>>> = {
  initiated: {
    issue_code: 'code_issued',
    // An admin re-issue against a match with no session yet. The endpoint
    // always sends `reissue_code`, and refusing it here made "issue a code for
    // this match" fail for exactly the matches that had never had one.
    reissue_code: 'code_issued',
    cancel: 'cancelled',
  },
  code_issued: {
    // Re-issuing an open session is allowed and keeps the attempt budget; see
    // the transition rules in the machine, which own that part.
    issue_code: 'code_issued',
    reissue_code: 'code_issued',
    present_code: 'awaiting_meet',
    confirm_receipt: 'verified',
    fail_attempt: 'code_issued',
    block: 'blocked',
    expire: 'expired',
    cancel: 'cancelled',
  },
  awaiting_meet: {
    // The second party confirms. Only reachable when two-party confirmation is
    // on; with it off, `code_issued` goes straight to `verified`.
    confirm_receipt: 'verified',
    fail_attempt: 'awaiting_meet',
    block: 'blocked',
    expire: 'expired',
    cancel: 'cancelled',
  },
  verified: {
    complete: 'completed',
    // The saga could not finish and gave up. An admin reopens it rather than
    // the session sitting verified with no handover record behind it.
    reissue_code: 'code_issued',
    dispute: 'disputed',
    cancel: 'cancelled',
  },
  completed: {
    dispute: 'disputed',
    revert: 'reverted',
  },
  blocked: {
    reissue_code: 'code_issued',
    cancel: 'cancelled',
  },
  expired: {
    // Both, because the old flow refused only `verified` and `blocked`: an
    // expired session was re-issued freely by a re-triggered match run or an
    // admin re-verifying the match. Dropping `issue_code` here turned both of
    // those into a 400 for the operator.
    issue_code: 'code_issued',
    reissue_code: 'code_issued',
    cancel: 'cancelled',
  },
  cancelled: {
    reissue_code: 'code_issued',
  },
  disputed: {
    revert: 'reverted',
    // A dispute that was not upheld puts the handover back where it was.
    complete: 'completed',
  },
  reverted: {
    reissue_code: 'code_issued',
  },
};

/** States from which nothing further happens on its own. */
const TERMINAL: ReadonlySet<HandoverState> = new Set(['completed', 'cancelled', 'reverted']);

/** States where a code can still be presented. */
const LIVE: ReadonlySet<HandoverState> = new Set(['code_issued', 'awaiting_meet']);

export function isTerminal(state: HandoverState): boolean {
  return TERMINAL.has(state);
}

/** Whether a code may still be presented against this state. */
export function acceptsCode(state: HandoverState): boolean {
  return LIVE.has(state);
}

/** Where a transition leads, or null when the table has no such edge. */
export function nextState(from: HandoverState, transition: HandoverTransition): HandoverState | null {
  return TABLE[from][transition] ?? null;
}

export function canTransition(from: HandoverState, transition: HandoverTransition): boolean {
  return nextState(from, transition) !== null;
}

/** Every transition the table allows from a state, for the admin screen. */
export function allowedFrom(state: HandoverState): HandoverTransition[] {
  return Object.keys(TABLE[state]) as HandoverTransition[];
}

export function isHandoverState(value: unknown): value is HandoverState {
  return typeof value === 'string' && (HANDOVER_STATES as readonly string[]).includes(value);
}

/**
 * The state a document written before the event log carries.
 *
 * Read rather than migrated, because a projection that can read the old shape
 * is what lets the new code deploy before the backfill runs instead of after
 * it. `npm run migrate:handovers` writes `state` onto the old documents; until
 * it has, this is what answers for them.
 */
export function fromLegacyStatus(status: string | undefined): HandoverState {
  switch (status) {
    case 'verified':
      // The old flow completed inline the moment the code was accepted, so a
      // stored `verified` is a handover that finished. Reading it as the new
      // intermediate `verified` would offer an admin a session to reopen that
      // has already happened.
      return 'completed';
    case 'blocked':
      return 'blocked';
    case 'expired':
      return 'expired';
    case 'pending':
      return 'code_issued';
    default:
      // Fails closed. Anything unclassifiable — a half-written document, a
      // status added later, a field that is not a string — reads as a session
      // that has not been opened, which accepts no credential and has only
      // `issue_code` and `cancel` out of it. Defaulting to `code_issued`, the
      // most permissive live state, meant a corrupt document was a handover
      // anybody could transition.
      return 'initiated';
  }
}

/**
 * The legacy `status` for a state, for readers that predate this phase.
 *
 * The projection keeps writing it so the admin sessions list, the status
 * endpoint's older consumers and any dashboard reading the collection
 * directly keep working while the new field rolls out.
 */
export function toLegacyStatus(state: HandoverState): 'pending' | 'verified' | 'blocked' | 'expired' {
  switch (state) {
    case 'completed':
      return 'verified';
    case 'verified':
      // Not `verified`. In the old vocabulary that meant the items were
      // Claimed, the credits paid and the record written; here it means only
      // that the credential was accepted and the saga has not finished. A
      // stale reader told `verified` asserts a handover that may still fail,
      // and the admin session list — which queries pending, blocked and
      // expired — would stop showing a session that is stuck.
      return 'pending';
    case 'blocked':
    case 'disputed':
      return 'blocked';
    case 'expired':
    case 'cancelled':
    case 'reverted':
      return 'expired';
    default:
      return 'pending';
  }
}

export interface HandoverEventRecord {
  from: HandoverState | null;
  to: HandoverState;
  transition: HandoverTransition;
  at: Date;
}

/**
 * Fold an event log into the state it describes.
 *
 * Order is the log's, not the reader's: events are appended with a sequence
 * number, and a projection built from a set sorted by timestamp alone would
 * reorder two events written in the same millisecond.
 */
export function project(events: HandoverEventRecord[]): HandoverState | null {
  return events.length === 0 ? null : events[events.length - 1].to;
}
