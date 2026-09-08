/**
 * Composition for the producer side.
 *
 * Chooses the driver once, from configuration, and hands the same `JobQueue`
 * to every producer. Redis when `REDIS_URL` is set, in-process otherwise, and
 * a warning either way when a production process is running without it.
 */

import { env } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import { BullMqJobQueue } from './bullmq.queue.js';
import { InlineJobQueue } from './inline.queue.js';
import { createRedisConnection } from './redis.connection.js';
import type { JobQueue } from './queue.port.js';

const log = createLogger('jobs');

let queue: JobQueue | null = null;

export function createJobQueue(): JobQueue {
  if (!env.queue.redisUrl) {
    if (env.isProduction) {
      log.warn(
        'REDIS_URL is not set, so background jobs run inside the API process and are lost on restart',
      );
    }

    return new InlineJobQueue();
  }

  return new BullMqJobQueue(createRedisConnection(env.queue.redisUrl, 'producer'));
}

export function getJobQueue(): JobQueue {
  if (!queue) {
    queue = createJobQueue();
    log.info('Job queue ready', { driver: queue.driver });
  }

  return queue;
}

/** Composition seam. Tests and the worker entrypoint set their own driver. */
export function setJobQueue(next: JobQueue | null): void {
  queue = next;
}

export async function closeJobQueue(): Promise<void> {
  const current = queue;

  queue = null;

  await current?.close();
}
