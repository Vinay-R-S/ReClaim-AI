/**
 * The outbox drainer.
 *
 * Polls for committed events and hands each one to the queue, exactly once per
 * event: the lease keeps two drainers off the same row, and the job's own
 * idempotency key keeps a redelivery from running the work twice. Publication
 * failures back off and retry; an event that cannot be published at all is
 * marked dead and left in place, because a row that cannot be found is a side
 * effect nobody knows was lost.
 */

import { createLogger } from '../../utils/logger.js';
import { continueTrace, runWithTraceContext } from '../tracing/context.js';
import { routeEvent } from './event.catalog.js';
import { outboxRepository, OutboxRepository } from './outbox.repository.js';
import type { JobQueue } from '../jobs/queue.port.js';

const log = createLogger('outbox');

export interface OutboxDrainerOptions {
  pollIntervalMs: number;
  batchSize: number;
  /** How long one drainer owns a row before another may retry it. */
  leaseMs: number;
  maxAttempts: number;
}

export const DEFAULT_DRAINER_OPTIONS: OutboxDrainerOptions = {
  pollIntervalMs: 2_000,
  batchSize: 20,
  leaseMs: 30_000,
  maxAttempts: 5,
};

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export interface DrainSummary {
  published: number;
  skipped: number;
  failed: number;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export class OutboxDrainer {
  private timer: NodeJS.Timeout | null = null;

  private running = false;

  private draining: Promise<DrainSummary> | null = null;

  constructor(
    private readonly queue: JobQueue,
    private readonly outbox: OutboxRepository = outboxRepository,
    private readonly options: OutboxDrainerOptions = DEFAULT_DRAINER_OPTIONS,
  ) {}

  start(): void {
    if (this.running) return;

    this.running = true;
    log.info('Outbox drainer started', {
      pollIntervalMs: this.options.pollIntervalMs,
      batchSize: this.options.batchSize,
    });

    this.scheduleNext(0);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // A pass in flight is allowed to finish, so a shutdown never leaves a row
    // leased by a process that no longer exists.
    await this.draining?.catch(() => undefined);
  }

  /**
   * One pass over the due events.
   *
   * Public because it is the whole of the drainer's behaviour: the timer is
   * only what calls it, and a test should not have to wait for a timer.
   */
  async drainOnce(): Promise<DrainSummary> {
    const summary: DrainSummary = { published: 0, skipped: 0, failed: 0 };
    const due = await this.outbox.listDue(this.options.batchSize);

    for (const record of due) {
      const leased = await this.outbox.lease(record.id, this.options.leaseMs);

      if (!leased) {
        summary.skipped += 1;
        continue;
      }

      const published = await this.publish(record.id, record);

      if (published) summary.published += 1;
      else summary.failed += 1;
    }

    return summary;
  }

  private async publish(
    id: string,
    record: {
      name: string;
      payload: Record<string, unknown>;
      attempts: number;
      traceparent: string;
    },
  ): Promise<boolean> {
    const trace = continueTrace(record.traceparent);

    return runWithTraceContext(trace, async () => {
      const dispatch = routeEvent(
        id,
        record.name as Parameters<typeof routeEvent>[1],
        record.payload,
      );

      // Nothing consumes this event yet, which is a fact about the catalogue
      // rather than a failure. It is published so it stops being retried.
      if (!dispatch) {
        await this.outbox.markPublished(id);
        log.debug('Outbox event has no consumer', { event: record.name, id });
        return true;
      }

      try {
        await this.queue.enqueue(dispatch.name, dispatch.payload, {
          idempotencyKey: dispatch.idempotencyKey,
          traceparent: record.traceparent,
        });

        await this.outbox.markPublished(id);
        log.info('Outbox event published', { event: record.name, job: dispatch.name, id });

        return true;
      } catch (error) {
        await this.recordFailure(id, record.attempts, error);

        return false;
      }
    });
  }

  private async recordFailure(id: string, attempts: number, error: unknown): Promise<void> {
    const next = attempts + 1;
    const message = describe(error);

    if (next >= this.options.maxAttempts) {
      await this.outbox.markDead(id, next, message);
      log.error('Outbox event dead-lettered', { id, attempts: next, error });

      return;
    }

    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);

    await this.outbox.markFailed(id, next, new Date(Date.now() + backoff), message);
    log.warn('Outbox publication failed, backing off', { id, attempts: next, backoff });
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;

    this.timer = setTimeout(() => {
      this.draining = this.drainOnce();

      this.draining
        .catch((error: unknown) => {
          log.error('Outbox drain pass failed', { error });

          return null;
        })
        .finally(() => {
          this.draining = null;
          this.scheduleNext(this.options.pollIntervalMs);
        });
    }, delayMs);

    // The timer must never be the reason a process stays alive.
    this.timer.unref();
  }
}
