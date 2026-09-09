/**
 * The worker process.
 *
 * Drains the outbox and consumes the queues. It holds no HTTP surface, so a
 * slow LLM call or a retry storm costs a background worker rather than a
 * request, which is the whole point of having a second process.
 *
 * Two connections on purpose: BullMQ blocks a connection while a worker waits
 * for a job, so the drainer's producer connection has to be its own or an
 * enqueue would wait behind a consumer.
 */

import { env } from './config/env.js';
import { createLogger } from './utils/logger.js';
import { BullMqJobQueue } from './platform/jobs/bullmq.queue.js';
import { BullMqJobWorker } from './platform/jobs/bullmq.worker.js';
import { JobRunner } from './platform/jobs/job.runner.js';
import { jobHandlers } from './platform/jobs/handlers/index.js';
import { createRedisConnection } from './platform/jobs/redis.connection.js';
import { setJobQueue } from './platform/jobs/queue.js';
import { closeSharedRedis } from './platform/redis/shared.js';
import { DEFAULT_DRAINER_OPTIONS, OutboxDrainer } from './platform/outbox/outbox.drainer.js';

const log = createLogger('worker');

env.warnings.forEach((warning) => log.warn(`Configuration warning: ${warning}`));

if (!env.queue.redisUrl) {
  // A worker without a queue is a process that will never be given anything to
  // do, and saying so is more useful than idling.
  log.error('REDIS_URL is not set, so there is no queue to consume. See ADR 0005.');
  process.exit(1);
}

const queue = new BullMqJobQueue(createRedisConnection(env.queue.redisUrl, 'producer'));

// Producers in this process (a job that enqueues another job) share the driver
// the drainer publishes to.
setJobQueue(queue);

const drainer = new OutboxDrainer(queue, undefined, {
  ...DEFAULT_DRAINER_OPTIONS,
  pollIntervalMs: env.queue.outboxPollIntervalMs,
  batchSize: env.queue.outboxBatchSize,
});

const worker = new BullMqJobWorker(
  createRedisConnection(env.queue.redisUrl, 'consumer'),
  new JobRunner(jobHandlers),
  env.queue.concurrency,
);

await worker.start();
drainer.start();

log.info('Worker ready', { concurrency: env.queue.concurrency });

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;

  shuttingDown = true;
  log.info(`Shutting down on ${signal}`);

  // The drainer stops first: a job published after the consumers close would
  // sit in Redis with nothing to run it until the next deploy.
  await drainer.stop();
  await worker.stop();
  await queue.close();
  // Separate from the queue's connections: the AI cache and rate budget use it.
  await closeSharedRedis();

  process.exit(0);
}

/** A failure to shut down cleanly must still shut down. */
function onSignal(signal: string): void {
  shutdown(signal).catch((error: unknown) => {
    log.error('Shutdown failed', { error });
    process.exit(1);
  });
}

process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

export { drainer, worker };
