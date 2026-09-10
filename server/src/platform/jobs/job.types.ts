/**
 * The job catalogue.
 *
 * Every background unit of work the system runs is named here with the shape
 * of its payload, so a producer cannot enqueue something no consumer knows how
 * to run and a consumer cannot read a field the producer never sends.
 */

export const JOB_NAMES = [
  'match.item',
  'embed.item',
  // The handover completion saga (PLAN.md 10.2). One job per side effect, so
  // each carries its own retry policy and its own dead-letter queue: a chain
  // write that is down must not hold up the email, and an email that bounces
  // must not re-award credits.
  'handover.items',
  'handover.archive',
  'handover.credits',
  'handover.notify',
  'handover.chain',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

/** Why a matching run was asked for. Carried for the log, not for behaviour. */
export type MatchItemReason = 'created' | 'approved' | 'rematch';

export interface MatchItemPayload {
  itemId: string;
  reason: MatchItemReason;
}

/**
 * Why an item is being embedded. Carried for the log, not for behaviour.
 *
 * Only what the catalogue can actually raise. An edit does not raise an event
 * today, so an approved item whose owner rewrites its description keeps its
 * old vector until the backfill runs; adding `item.updated` is the fix and it
 * belongs with the retrieval phase that makes a stale vector matter.
 */
export type EmbedItemReason = 'created' | 'approved';

export interface EmbedItemPayload {
  itemId: string;
  reason: EmbedItemReason;
}

/**
 * One step of the handover completion saga.
 *
 * Every step takes the same payload, because every step is about the same
 * handover and the step itself is the job name. `handoverId` is the match id,
 * which is what the code document has always been keyed on.
 */
export interface HandoverStepPayload {
  handoverId: string;
  lostItemId: string;
  foundItemId: string;
}

export interface JobPayloads {
  'match.item': MatchItemPayload;
  'embed.item': EmbedItemPayload;
  'handover.items': HandoverStepPayload;
  'handover.archive': HandoverStepPayload;
  'handover.credits': HandoverStepPayload;
  'handover.notify': HandoverStepPayload;
  'handover.chain': HandoverStepPayload;
}

/**
 * What actually travels to the worker.
 *
 * `idempotencyKey` is stable across every retry and every replay of the same
 * unit of work, and `traceparent` is what makes the worker's log lines join
 * the request that caused them.
 */
export interface JobEnvelope<N extends JobName = JobName> {
  name: N;
  payload: JobPayloads[N];
  idempotencyKey: string;
  traceparent: string;
  enqueuedAt: string;
}

export interface RetryPolicy {
  /** Total attempts including the first, so 1 means no retry. */
  attempts: number;
  /** First backoff step; each further attempt doubles it. */
  backoffMs: number;
  /** How long a single attempt may run before it is abandoned. */
  timeoutMs: number;
}

/**
 * Per-job retry policy.
 *
 * Matching calls an LLM and a vision provider, both of which fail in bursts,
 * so it retries three times over roughly a minute and then dead-letters rather
 * than holding a queue slot forever.
 *
 * Embedding is local inference, so the only things that fail are a first model
 * download and an image fetch. Both are worth another go, and neither is worth
 * a long one: the timeout is generous only because a cold start pays for the
 * model load once.
 */
export const RETRY_POLICIES: Record<JobName, RetryPolicy> = {
  'match.item': { attempts: 3, backoffMs: 10_000, timeoutMs: 120_000 },
  'embed.item': { attempts: 3, backoffMs: 5_000, timeoutMs: 180_000 },

  // The saga steps, and the budgets say what each failure costs.
  //
  // Moving the two items and archiving the match are Firestore writes against
  // documents that already exist: they fail on contention or an outage, both
  // of which pass. Credits are a ledger write and the one step nobody wants
  // retried loosely, so it leans on its idempotency key rather than on
  // attempts. Email is a third party that rate limits, so it is patient. The
  // chain is the slowest and the least urgent: a handover is not less true
  // because the attestation is late.
  'handover.items': { attempts: 5, backoffMs: 2_000, timeoutMs: 30_000 },
  'handover.archive': { attempts: 5, backoffMs: 2_000, timeoutMs: 30_000 },
  'handover.credits': { attempts: 3, backoffMs: 5_000, timeoutMs: 30_000 },
  'handover.notify': { attempts: 5, backoffMs: 30_000, timeoutMs: 60_000 },
  'handover.chain': { attempts: 4, backoffMs: 60_000, timeoutMs: 180_000 },
};

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}
