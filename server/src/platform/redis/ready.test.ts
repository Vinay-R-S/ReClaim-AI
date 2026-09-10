/**
 * The first-connect gate.
 *
 * Every Redis client here is built with `enableOfflineQueue: false`, so a
 * command issued during an outage fails instead of hanging. That is right
 * during an outage and wrong during the opening handshake, when nothing is
 * down and the socket simply is not open yet: ioredis rejects with "Stream
 * isn't writeable and enableOfflineQueue options is false". CI hit exactly
 * that against a Redis service the workflow had already health checked, and
 * the shared cache client hit it on every process start, where it read as a
 * cache miss rather than as an error.
 *
 * These use a fake emitter rather than a real client, because what is being
 * pinned is the gate's own behaviour: it waits for the first ready, it stops
 * waiting once a connection has opened, and it never waits forever.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { trackReady, whenReady } from './ready.js';
import type { Redis } from 'ioredis';

/**
 * Whether a promise has settled by the next macrotask.
 *
 * A synchronous flag check in the tick the `then` was attached is true of any
 * implementation, including one that resolves immediately, which is the one
 * property this gate has to have. A microtask race is not enough either: an
 * already-resolved `whenReady` still loses to `Promise.resolve()` by a tick.
 */
async function settlesImmediately(promise: Promise<unknown>): Promise<boolean> {
  const tick = new Promise<'pending'>((resolve) => {
    setTimeout(() => resolve('pending'), 0);
  });

  return (await Promise.race([promise.then(() => 'settled' as const), tick])) === 'settled';
}

/** Just enough of ioredis for the gate: a status and the two events it uses. */
function fakeConnection(status: string) {
  const emitter = new EventEmitter() as EventEmitter & { status: string };

  emitter.status = status;

  return emitter as unknown as Redis;
}

describe('whenReady', () => {
  it('resolves immediately when the connection is already ready', async () => {
    const connection = fakeConnection('ready');

    await expect(whenReady(connection)).resolves.toBeUndefined();
  });

  it('waits for the first ready event when the socket is still opening', async () => {
    const connection = fakeConnection('connecting');

    expect(await settlesImmediately(whenReady(connection))).toBe(false);

    connection.emit('ready');

    await expect(whenReady(connection)).resolves.toBeUndefined();
  });

  it('stops gating once the connection has been ready, so an outage fails fast', async () => {
    // The reason this only guards the first connect. A connection that drops
    // mid-life is an outage, and waiting there would add the timeout to every
    // request that touches Redis, which is what `enableOfflineQueue: false`
    // exists to prevent.
    const connection = fakeConnection('connecting');
    const first = whenReady(connection);

    connection.emit('ready');
    await first;

    (connection as unknown as { status: string }).status = 'reconnecting';

    expect(await settlesImmediately(whenReady(connection))).toBe(true);
  });

  it('stops waiting altogether once a first connect has timed out', async () => {
    // ioredis reconnects forever by default, so a client pointed at an
    // unreachable Redis never emits `ready` and never emits `end`. Re-arming
    // the wait on every call made a missing Redis cost five seconds per cache
    // read, per cache write and per rate-limit check, for the life of the
    // process — the stall `enableOfflineQueue: false` exists to prevent.
    const connection = fakeConnection('connecting');

    await whenReady(connection, 1);

    expect(await settlesImmediately(whenReady(connection, 10_000))).toBe(true);
  });

  it('still recognises a connection that opens after its first wait timed out', async () => {
    const connection = fakeConnection('connecting');

    trackReady(connection);
    await whenReady(connection, 1);

    connection.emit('ready');
    (connection as unknown as { status: string }).status = 'ready';

    await expect(whenReady(connection)).resolves.toBeUndefined();
  });

  it('does not wait on a connection that has been closed for good', async () => {
    // Shutdown reaches this: a straggler calling in after `quit()` would
    // otherwise add the whole timeout to each of its commands.
    const connection = fakeConnection('end');

    expect(await settlesImmediately(whenReady(connection))).toBe(true);
  });

  it('gives up waiting when the connection ends, rather than holding the caller', async () => {
    const connection = fakeConnection('connecting');

    const waiting = whenReady(connection);

    connection.emit('end');

    await expect(waiting).resolves.toBeUndefined();
  });

  it('resolves on its own timeout so the caller sees the real error, not a generic one', async () => {
    vi.useFakeTimers();

    try {
      const connection = fakeConnection('reconnecting');
      const waiting = whenReady(connection, 50);

      await vi.advanceTimersByTimeAsync(50);

      await expect(waiting).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares one wait across callers rather than adding a listener each time', async () => {
    const connection = fakeConnection('connecting');

    const first = whenReady(connection);
    const second = whenReady(connection);

    expect(second).toBe(first);
    expect(connection.listenerCount('ready')).toBe(1);

    connection.emit('ready');
    await first;
  });

  it('resolves for a connection that has already been ready', async () => {
    const connection = fakeConnection('ready');

    await expect(whenReady(connection)).resolves.toBeUndefined();
    expect(connection.listenerCount('ready')).toBe(0);
  });

  it('remembers a connection that opened before anybody waited on it', async () => {
    // What `trackReady` is for. A client created at boot and first used a
    // minute later has been ready, and a gate looking only at `status` would
    // wait again if the status happened to read `reconnecting` at that moment.
    const connection = fakeConnection('connecting');

    trackReady(connection);
    connection.emit('ready');

    (connection as unknown as { status: string }).status = 'reconnecting';

    expect(await settlesImmediately(whenReady(connection))).toBe(true);
  });

  it('removes its listeners once it has settled', async () => {
    const connection = fakeConnection('connecting');
    const waiting = whenReady(connection);

    connection.emit('ready');
    await waiting;

    expect(connection.listenerCount('ready')).toBe(0);
    expect(connection.listenerCount('end')).toBe(0);
  });
});
