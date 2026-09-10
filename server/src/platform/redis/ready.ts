/**
 * The first-connect gate, shared by every Redis client in the process.
 *
 * Every connection this application opens is created with
 * `enableOfflineQueue: false`, so a command issued while Redis is unreachable
 * fails immediately instead of buffering. That is the behaviour a request
 * wants during an outage: a queue outage must degrade the caller, never stall
 * it, and a cache that blocks is worse than no cache.
 *
 * It is the wrong behaviour in exactly one moment. Right after the client is
 * constructed the socket is still being opened: nothing is down, and ioredis
 * rejects with `Stream isn't writeable and enableOfflineQueue options is
 * false`. Every client here is created lazily, on the first call that wants
 * it, so the command that lands in that window is the first command of the
 * process — and because the callers treat a failure as "fall back to memory",
 * it fails silently and once per process, forever.
 *
 * That is not theoretical: it is why the first AI response-cache lookup always
 * missed, the first rate-limit check always allowed, and the first embedding
 * cache lookup always missed, on every process start. CI hit the same window
 * in the queue integration test against a Redis service the workflow had
 * already health checked.
 *
 * So this waits for the opening handshake and nothing else. Once a connection
 * has been ready, every later call returns immediately even if Redis has since
 * dropped: waiting there would reintroduce the stall the option exists to
 * prevent, and turn a Redis restart into five seconds added to every request
 * that touches it.
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('redis:ready');

/** How long to wait for the very first connect before giving up. */
const FIRST_CONNECT_TIMEOUT_MS = 5_000;

/** Connections that have been ready at least once. */
const everReady = new WeakSet<Redis>();

/**
 * The wait for a connection, kept after it settles.
 *
 * Kept, not cleared, and that is the whole of finding-and-fixing this twice.
 * Clearing it on the timeout path looks like the careful choice — a connection
 * that never opened has not been proven ready, so why remember the answer? —
 * and it is the opposite. ioredis reconnects forever by default, so a client
 * pointed at an unreachable Redis never emits `ready` and never emits `end`:
 * every later call re-entered the slow path and armed another five seconds. A
 * worker booted against a missing Redis would pay that on every cache read,
 * every cache write and every rate-limit check, for the life of the process.
 *
 * Keeping the settled promise costs nothing in the case it was meant to guard.
 * A connection that opens late is recognised through `status === 'ready'` or
 * through `everReady`, both checked before this map, so the memo can only ever
 * make a call resolve immediately for a connection that is not ready — which
 * is the fail-fast behaviour `enableOfflineQueue: false` asks for.
 */
const waits = new WeakMap<Redis, Promise<void>>();

/** ioredis states from which no `ready` can follow. */
function isTerminal(connection: Redis): boolean {
  return connection.status === 'end';
}

/**
 * Watch a connection from the moment it is created.
 *
 * Called by whoever constructs the client, so a connection that became ready
 * before anybody asked is still recognised as ready.
 */
export function trackReady(connection: Redis): void {
  connection.on('ready', () => everReady.add(connection));
}

/**
 * Resolve once the connection has completed its opening handshake.
 *
 * Resolves rather than rejects when it gives up: the caller's own command then
 * produces the real error, which says more than a generic one from here.
 */
export function whenReady(
  connection: Redis,
  timeoutMs = FIRST_CONNECT_TIMEOUT_MS,
): Promise<void> {
  // A closed connection will never be ready, and waiting the full timeout for
  // one only delays the error the caller already has. Shutdown reaches this:
  // a straggler calling in after `quit()` would otherwise add the timeout to
  // every one of its commands.
  if (connection.status === 'ready' || everReady.has(connection) || isTerminal(connection)) {
    return Promise.resolve();
  }

  const pending = waits.get(connection);

  if (pending) return pending;

  const wait = new Promise<void>((resolve) => {
    const settle = (): void => {
      clearTimeout(timer);
      connection.off('ready', onReady);
      connection.off('end', settle);
      resolve();
    };

    const onReady = (): void => {
      everReady.add(connection);
      settle();
    };

    const timer = setTimeout(() => {
      log.warn('Redis was not ready in time; the command decides what happens next');
      settle();
    }, timeoutMs);

    // `unref` so a process with nothing else to do is not held open by it.
    timer.unref();

    connection.once('ready', onReady);
    // A connection that gave up reconnecting will never be ready either.
    connection.once('end', settle);
  });

  waits.set(connection, wait);

  return wait;
}
