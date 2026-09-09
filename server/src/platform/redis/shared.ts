/**
 * The shared Redis connection for cache and counters.
 *
 * Deliberately not the queue's connections: BullMQ blocks a connection while a
 * worker waits, so anything that wants a fast GET needs its own. One lazily
 * created client is enough for everything else, and when Redis is not
 * configured this returns null and each caller falls back to process memory.
 */

import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('redis:shared');

let client: Redis | null = null;
let attempted = false;
let closed = false;

export function getSharedRedis(): Redis | null {
  // After shutdown there is nobody left to close a new connection, and a
  // request still in flight when the signal arrived would otherwise open one
  // with the default infinite reconnect strategy. Memory is the right
  // fallback at that point.
  if (closed) return null;
  if (attempted) return client;

  attempted = true;

  if (!env.queue.redisUrl) return null;

  client = new Redis(env.queue.redisUrl, {
    maxRetriesPerRequest: 2,
    // A cache that blocks is worse than no cache: a command issued while Redis
    // is down fails immediately and the caller falls back to memory.
    enableOfflineQueue: false,
    connectionName: 'reclaim-shared',
  });

  client.on('error', (error: unknown) => log.warn('Shared Redis error', { error }));

  return client;
}

export async function closeSharedRedis(): Promise<void> {
  const current = client;

  client = null;
  closed = true;

  await current?.quit().catch(() => undefined);
}

/** Test seam. Production closes once, on the way out. */
export function resetSharedRedis(): void {
  client = null;
  attempted = false;
  closed = false;
}
