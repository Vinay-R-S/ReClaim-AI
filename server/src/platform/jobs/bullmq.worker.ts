/**
 * The consumer side of the Redis driver.
 *
 * One BullMQ worker per job name. Everything about how a job runs lives in
 * `JobRunner`; what is here is delivery, concurrency, the lock that keeps a
 * long attempt from being handed to a second worker, and the dead letter
 * written when the last attempt fails.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { createLogger } from '../../utils/logger.js';
import { deadLetterRepository } from './deadletter.repository.js';
import { queueNameFor } from './bullmq.queue.js';
import { JOB_NAMES, RETRY_POLICIES, type JobEnvelope } from './job.types.js';
import type { JobRunner } from './job.runner.js';
import type { DeadLetterSink, JobWorker } from './queue.port.js';

const log = createLogger('jobs:worker');

/** The lock must outlive the attempt, or a slow job is delivered twice. */
const LOCK_MARGIN_MS = 30_000;

export class BullMqJobWorker implements JobWorker {
  private readonly workers: Worker[] = [];

  constructor(
    private readonly connection: Redis,
    private readonly runner: JobRunner,
    private readonly concurrency: number,
    private readonly deadLetters: DeadLetterSink = deadLetterRepository,
  ) {}

  async start(): Promise<void> {
    JOB_NAMES.forEach((name) => {
      const policy = RETRY_POLICIES[name];

      const worker = new Worker(
        queueNameFor(name),
        async (job: Job<JobEnvelope>) => this.process(job),
        {
          connection: this.connection,
          concurrency: this.concurrency,
          lockDuration: policy.timeoutMs + LOCK_MARGIN_MS,
        },
      );

      worker.on('error', (error: unknown) => log.error('Worker error', { job: name, error }));

      // The dead letter is written here rather than in the processor, because
      // a job can exhaust its attempts without the processor ever running: a
      // worker killed mid-job stalls, and BullMQ fails a stalled job on its
      // own. Recording in one place also keeps a thrown failure from being
      // recorded twice.
      worker.on('failed', (job: Job<JobEnvelope> | undefined, error: Error) => {
        if (!job || job.attemptsMade < policy.attempts) return;

        void this.deadLetters.record(job.data, error, job.attemptsMade);
      });

      this.workers.push(worker);
      log.info('Worker listening', { job: name, concurrency: this.concurrency });
    });
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.workers.length = 0;
    // Same guard as the producer's: a `quit` that cannot be written must still
    // close the connection rather than fail the shutdown that asked for it.
    await this.connection.quit().catch(() => this.connection.disconnect());
  }

  private async process(job: Job<JobEnvelope>): Promise<void> {
    const envelope = job.data;
    const policy = RETRY_POLICIES[envelope.name];

    // BullMQ increments `attemptsMade` after the processor returns, so the
    // first run sees zero.
    await this.runner.run(envelope, job.attemptsMade + 1, policy.attempts);
  }
}
