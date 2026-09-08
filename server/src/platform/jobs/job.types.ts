/**
 * The job catalogue.
 *
 * Every background unit of work the system runs is named here with the shape
 * of its payload, so a producer cannot enqueue something no consumer knows how
 * to run and a consumer cannot read a field the producer never sends.
 */

export const JOB_NAMES = ['match.item'] as const;

export type JobName = (typeof JOB_NAMES)[number];

/** Why a matching run was asked for. Carried for the log, not for behaviour. */
export type MatchItemReason = 'created' | 'approved' | 'rematch';

export interface MatchItemPayload {
  itemId: string;
  reason: MatchItemReason;
}

export interface JobPayloads {
  'match.item': MatchItemPayload;
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
 */
export const RETRY_POLICIES: Record<JobName, RetryPolicy> = {
  'match.item': { attempts: 3, backoffMs: 10_000, timeoutMs: 120_000 },
};

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}
