/**
 * The shared cache and counter client.
 *
 * One property is worth a test file of its own: the first caller does not get
 * the client until the socket is open. This client does not buffer, so before
 * the gate existed the first command of every process raced the handshake and
 * lost — and because every caller treats a failure as "fall back to memory",
 * it failed silently. The first AI response-cache lookup always missed, the
 * first rate-limit check always allowed, and the first embedding cache lookup
 * always missed, once per process, forever.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A fake ioredis: an emitter with a status the test drives by hand. */
class FakeRedis extends EventEmitter {
  status = 'connecting';

  readonly options: unknown;

  constructor(url: string, options: unknown) {
    super();
    this.options = options;
    created.push(this);
  }

  becomeReady(): void {
    this.status = 'ready';
    this.emit('ready');
  }

  async quit(): Promise<void> {
    this.status = 'end';
  }

  disconnect(): void {
    this.status = 'end';
  }
}

const created: FakeRedis[] = [];

vi.mock('ioredis', () => ({ Redis: FakeRedis }));

vi.mock('../../config/env.js', () => ({
  env: { queue: { redisUrl: 'redis://localhost:6379' } },
}));

const { getSharedRedis, resetSharedRedis, closeSharedRedis } = await import('./shared.js');

/** Whether a promise has settled by the next macrotask. */
async function settlesImmediately(promise: Promise<unknown>): Promise<boolean> {
  const tick = new Promise<'pending'>((resolve) => {
    setTimeout(() => resolve('pending'), 0);
  });

  return (await Promise.race([promise.then(() => 'settled' as const), tick])) === 'settled';
}

beforeEach(() => {
  created.length = 0;
  resetSharedRedis();
});

afterEach(async () => {
  await closeSharedRedis();
  resetSharedRedis();
});

describe('getSharedRedis', () => {
  it('does not hand out the client until the socket is open', async () => {
    const pending = getSharedRedis();

    expect(created).toHaveLength(1);
    expect(await settlesImmediately(pending)).toBe(false);

    created[0].becomeReady();

    await expect(pending).resolves.toBe(created[0]);
  });

  it('creates the client without an offline queue, so an outage fails fast', async () => {
    const pending = getSharedRedis();

    created[0].becomeReady();
    await pending;

    expect(created[0].options).toMatchObject({ enableOfflineQueue: false });
  });

  it('returns immediately on every later call, so an outage does not stall one', async () => {
    const first = getSharedRedis();

    created[0].becomeReady();
    await first;

    // Dropped after having been open. This is an outage, and the caller must
    // get a client that fails fast rather than a wait.
    created[0].status = 'reconnecting';

    expect(await settlesImmediately(getSharedRedis())).toBe(true);
  });

  it('opens exactly one client however many callers ask', async () => {
    const calls = [getSharedRedis(), getSharedRedis(), getSharedRedis()];

    created[0].becomeReady();

    const clients = await Promise.all(calls);

    expect(created).toHaveLength(1);
    expect(new Set(clients).size).toBe(1);
  });

  it('falls back to memory once the process is shutting down', async () => {
    const first = getSharedRedis();

    created[0].becomeReady();
    await first;

    await closeSharedRedis();

    await expect(getSharedRedis()).resolves.toBeNull();
  });

  it('opens nothing at all when the signal arrived before the first caller', async () => {
    // The case the `closed` guard actually exists for. After shutdown there is
    // nobody left to close a new connection, and a request still in flight
    // would otherwise open one with an infinite reconnect strategy and hold
    // the process open.
    await closeSharedRedis();

    await expect(getSharedRedis()).resolves.toBeNull();
    expect(created).toHaveLength(0);
  });

  it('closes a client that never connected, rather than leaving it reconnecting', async () => {
    const pending = getSharedRedis();
    const client = created[0];

    // `quit` is a command, and this client refuses commands while the stream
    // is not writeable, so it rejects instead of closing.
    client.quit = async () => {
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
    };

    let disconnected = false;

    client.disconnect = () => {
      disconnected = true;
    };

    client.becomeReady();
    await pending;

    await expect(closeSharedRedis()).resolves.toBeUndefined();
    expect(disconnected).toBe(true);
  });
});
