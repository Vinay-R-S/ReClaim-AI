/**
 * The queue seen from both sides.
 *
 * Producers depend on `JobQueue` and consumers on `JobHandler`; neither names
 * Redis. That is what lets the same handler run under BullMQ in production and
 * in-process in a test, and what ADR 0005 means by keeping the driver
 * replaceable.
 */

import type { Logger } from '../../utils/logger.js';
import type { JobEnvelope, JobName, JobPayloads } from './job.types.js';

export type QueueDriver = 'redis' | 'inline';

export interface EnqueueOptions {
  /**
   * The exactly-once key. Two enqueues with the same key are the same unit of
   * work, however many times a producer retries. Defaults to a random key,
   * which means at-least-once and nothing more.
   */
  idempotencyKey?: string;
  delayMs?: number;
  /** Overrides the ambient trace, for a producer resuming a stored context. */
  traceparent?: string;
}

export interface EnqueueResult {
  jobId: string;
  /** False when the key was already queued or already run. */
  accepted: boolean;
}

export interface JobQueue {
  readonly driver: QueueDriver;
  enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options?: EnqueueOptions,
  ): Promise<EnqueueResult>;
  close(): Promise<void>;
}

export interface JobContext {
  /** 1 for the first run. */
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  log: Logger;
}

export type JobHandler<N extends JobName> = (
  payload: JobPayloads[N],
  context: JobContext,
) => Promise<void>;

export type JobHandlerMap = {
  [N in JobName]: JobHandler<N>;
};

export interface JobWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Where a job goes when its last attempt fails.
 *
 * Durable and outside the queue on purpose: a Redis eviction must not be able
 * to erase the record that something was dropped.
 */
export interface DeadLetterSink {
  record(envelope: JobEnvelope, error: unknown, attempts: number): Promise<void>;
}
