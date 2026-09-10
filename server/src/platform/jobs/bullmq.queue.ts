/**
 * The Redis driver (ADR 0005).
 *
 * One BullMQ queue per job name, so a slow job cannot starve a fast one and
 * each keeps its own retry policy. The idempotency key becomes the BullMQ job
 * id, which makes a duplicate enqueue a no-op at the queue rather than a
 * second run that the handler has to detect.
 */

import { createHash, randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { createLogger } from '../../utils/logger.js';
import { currentTraceparent } from '../tracing/context.js';
import { RETRY_POLICIES, type JobEnvelope, type JobName, type JobPayloads } from './job.types.js';
import type { EnqueueOptions, EnqueueResult, JobQueue } from './queue.port.js';

const log = createLogger('jobs:redis');

/** Kept out of Redis keys: a job id is a key fragment, not a description. */
export function toJobId(idempotencyKey: string): string {
  return createHash('sha1').update(idempotencyKey).digest('hex');
}

export function queueNameFor(job: JobName): string {
  return `reclaim.${job}`;
}

export class BullMqJobQueue implements JobQueue {
  readonly driver = 'redis' as const;

  private readonly queues = new Map<JobName, Queue>();

  constructor(private readonly connection: Redis) {}

  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    const policy = RETRY_POLICIES[name];
    const idempotencyKey = options.idempotencyKey ?? `${name}:${randomUUID()}`;
    const jobId = toJobId(idempotencyKey);

    const envelope: JobEnvelope<N> = {
      name,
      payload,
      idempotencyKey,
      traceparent: options.traceparent ?? currentTraceparent(),
      enqueuedAt: new Date().toISOString(),
    };

    const queue = this.queueFor(name);
    const existing = await queue.getJob(jobId);

    if (existing) {
      log.info('Duplicate enqueue ignored', { job: name, key: idempotencyKey });

      return { jobId, accepted: false };
    }

    await queue.add(name, envelope, {
      jobId,
      attempts: policy.attempts,
      backoff: { type: 'exponential', delay: policy.backoffMs },
      delay: options.delayMs,
      // Keep enough history to answer "did it run", not enough to be a store.
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 24 * 3600 },
    });

    return { jobId, accepted: true };
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();

    // `quit` is itself a command, and a producer connection refuses commands
    // when the stream is not writeable, so during a Redis outage it rejects
    // rather than closing. Unhandled, that rejection propagates through
    // `shutdown` and the process exits non-zero on every restart that happens
    // to land in a blip — and the shared client is never closed, because the
    // shutdown sequence never reaches it.
    await this.connection.quit().catch(() => this.connection.disconnect());
  }

  private queueFor(name: JobName): Queue {
    const existing = this.queues.get(name);

    if (existing) return existing;

    const queue = new Queue(queueNameFor(name), { connection: this.connection });

    this.queues.set(name, queue);

    return queue;
  }
}
