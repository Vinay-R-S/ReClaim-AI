/**
 * The in-process driver.
 *
 * Runs a job in the process that enqueued it, with the same idempotency,
 * timeout, retry and dead-letter behaviour as the Redis driver and none of the
 * durability: a restart loses whatever was in flight. It exists so that a
 * developer machine, a test, and a single-process deployment with no Redis
 * behave the way the system did before the queue existed, rather than silently
 * doing nothing. ADR 0005 is still the production answer.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../../utils/logger.js';
import { currentTraceparent } from '../tracing/context.js';
import { deadLetterRepository } from './deadletter.repository.js';
import {
  RETRY_POLICIES,
  type JobEnvelope,
  type JobName,
  type JobPayloads,
  type RetryPolicy,
} from './job.types.js';
import { JobRunner } from './job.runner.js';
import type { DeadLetterSink, EnqueueOptions, EnqueueResult, JobQueue } from './queue.port.js';

const log = createLogger('jobs:inline');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

export class InlineJobQueue implements JobQueue {
  readonly driver = 'inline' as const;

  private readonly inFlight = new Set<Promise<void>>();

  private runner: Promise<JobRunner> | null = null;

  private closed = false;

  constructor(
    private readonly deadLetters: DeadLetterSink = deadLetterRepository,
    private readonly policies: Record<JobName, RetryPolicy> = RETRY_POLICIES,
  ) {}

  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    const envelope: JobEnvelope<N> = {
      name,
      payload,
      idempotencyKey: options.idempotencyKey ?? `${name}:${randomUUID()}`,
      traceparent: options.traceparent ?? currentTraceparent(),
      enqueuedAt: new Date().toISOString(),
    };

    if (this.closed) {
      log.warn('Job dropped, the queue is closed', { job: name });

      return { jobId: envelope.idempotencyKey, accepted: false };
    }

    const work = this.execute(envelope, options.delayMs ?? 0);

    this.inFlight.add(work);
    void work.finally(() => this.inFlight.delete(work));

    return { jobId: envelope.idempotencyKey, accepted: true };
  }

  /** Settles when nothing is running. The seam tests and shutdown both need. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.whenIdle();
  }

  /**
   * Retries here are a loop rather than a redelivery, so the attempt counter
   * and the backoff are this driver's own. The handler cannot tell.
   */
  private async execute(envelope: JobEnvelope, delayMs: number): Promise<void> {
    const policy = this.policies[envelope.name];

    if (delayMs > 0) await delay(delayMs);

    // Nothing awaits this promise for its value, so it must not reject: an
    // unhandled rejection takes the process down, and the caller was answered
    // the moment the job was accepted.
    try {
      const runner = await this.resolveRunner();

      for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
        try {
          await runner.run(envelope, attempt, policy.attempts);

          return;
        } catch (error) {
          if (attempt >= policy.attempts) {
            await this.deadLetters.record(envelope, error, attempt);

            return;
          }

          await delay(policy.backoffMs * 2 ** (attempt - 1));
        }
      }
    } catch (error) {
      // Only the paths outside the retry loop reach here: loading the handler
      // registry, and the dead-letter write itself.
      log.error('Job could not be run at all', { job: envelope.name, error });
    }
  }

  /**
   * Handlers are imported on first use, not at module load.
   *
   * A handler reaches back into the services that enqueue jobs, so importing
   * the registry from here at load time would close an import cycle through
   * every service in the application.
   */
  private resolveRunner(): Promise<JobRunner> {
    if (!this.runner) {
      this.runner = import('./handlers/index.js').then(
        ({ jobHandlers }) => new JobRunner(jobHandlers),
      );
    }

    return this.runner;
  }
}
