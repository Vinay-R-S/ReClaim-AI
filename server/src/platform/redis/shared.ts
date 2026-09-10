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
import { trackReady, whenReady } from './ready.js';

const log = createLogger('redis:shared');

let client: Redis | null = null;
let attempted = false;
let closed = false;

/**
 * The shared client, once it is usable.
 *
 * Async because of the first call. This client is created lazily and does not
 * buffer, so the command that follows its construction races the opening
 * handshake and loses. Every caller here treats a failure as "fall back to
 * memory", so that race did not surface as an error: it made the first cache
 * lookup of every process miss and the first rate-limit check of every process
 * allow, silently and permanently. See `ready.ts`.
 *
 * The wait is for the first connect only. During an actual outage this returns
 * a client that fails fast, which is what the callers want.
 */
export async function getSharedRedis(): Promise<Redis | null> {
  // After shutdown there is nobody left to close a new connection, and a
  // request still in flight when the signal arrived would otherwise open one
  // with the default infinite reconnect strategy. Memory is the right
  // fallback at that point.
  if (closed) return null;

  if (!attempted) {
    attempted = true;

    if (!env.queue.redisUrl) return null;

    client = new Redis(env.queue.redisUrl, {
      maxRetriesPerRequest: 2,
      // A cache that blocks is worse than no cache: a command issued while
      // Redis is down fails immediately and the caller falls back to memory.
      enableOfflineQueue: false,
      connectionName: 'reclaim-shared',
    });

    trackReady(client);
    client.on('error', (error: unknown) => log.warn('Shared Redis error', { error }));
  }

  // Captured before the await, and checked after it. `resetSharedRedis` can
  // clear the module reference while this is waiting, and returning whatever
  // is there afterwards would hand the caller a client nobody gated — the
  // exact race this function exists to close.
  const current = client;

  if (!current) return null;

  await whenReady(current);

  return closed || client !== current ? null : current;
}

export async function closeSharedRedis(): Promise<void> {
  const current = client;

  client = null;
  closed = true;

  if (!current) return;

  // `quit` is a command, and this client refuses commands when the stream is
  // not writeable, so on a client that is down or was never up it rejects
  // instead of closing. Left at that, ioredis keeps its reconnect timer armed
  // and the process is held open by a connection nobody can use.
  await current.quit().catch(() => current.disconnect());
}

/** Test seam. Production closes once, on the way out. */
export function resetSharedRedis(): void {
  client = null;
  attempted = false;
  closed = false;
}
