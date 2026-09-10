/**
 * The response cache, and the shared client it reads.
 *
 * No shipped task sets a TTL, so the router never asks this to store anything
 * today; it is kept because a task can ask, and the reason it is tested is the
 * `await` on `getSharedRedis()`. Dropping that await turns the client into a
 * truthy Promise, `redis.get is not a function` throws, the surrounding catch
 * swallows it and the cache silently never hits — the same silent failure the
 * readiness gate exists to prevent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedRedis = vi.fn();

vi.mock('../../redis/shared.js', () => ({
  getSharedRedis: () => sharedRedis(),
}));

const { ResponseCache, cacheKey } = await import('./cache.js');

const RESPONSE = {
  content: 'answer',
  providerId: 'groq',
  model: 'groq-model',
  usage: { inputTokens: 10, outputTokens: 5 },
};

function fakeRedis() {
  const store = new Map<string, string>();

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);

      return 'OK';
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResponseCache', () => {
  it('round trips a response through Redis', async () => {
    const redis = fakeRedis();

    sharedRedis.mockResolvedValue(redis);

    const cache = new ResponseCache();

    await cache.set('key', RESPONSE, 60);

    expect(redis.set).toHaveBeenCalledTimes(1);
    await expect(cache.get('key')).resolves.toEqual(RESPONSE);
  });

  it('awaits the client rather than using the promise it returns', async () => {
    const redis = fakeRedis();

    sharedRedis.mockResolvedValue(redis);

    await new ResponseCache().get('key');

    expect(redis.get).toHaveBeenCalledWith('key');
  });

  it('drops a key on request, which is what a failed repair depends on', async () => {
    const redis = fakeRedis();

    sharedRedis.mockResolvedValue(redis);

    const cache = new ResponseCache();

    await cache.set('key', RESPONSE, 60);
    await cache.delete('key');

    await expect(cache.get('key')).resolves.toBeNull();
  });

  it('falls back to process memory when Redis is not configured', async () => {
    sharedRedis.mockResolvedValue(null);

    const cache = new ResponseCache();

    await cache.set('key', RESPONSE, 60);
    await expect(cache.get('key')).resolves.toEqual(RESPONSE);
  });

  it('misses rather than failing the call when Redis errors', async () => {
    sharedRedis.mockResolvedValue({
      get: vi.fn(async () => {
        throw new Error('down');
      }),
      set: vi.fn(async () => {
        throw new Error('down');
      }),
      del: vi.fn(async () => {
        throw new Error('down');
      }),
    });

    const cache = new ResponseCache();

    await expect(cache.set('key', RESPONSE, 60)).resolves.toBeUndefined();
    await expect(cache.get('key')).resolves.toBeNull();
    await expect(cache.delete('key')).resolves.toBeUndefined();
  });
});

describe('cacheKey', () => {
  it('separates two different questions to the same model', () => {
    const request = { messages: [{ role: 'user' as const, content: 'a' }] };
    const other = { messages: [{ role: 'user' as const, content: 'b' }] };

    expect(cacheKey('groq', 'm', request)).not.toBe(cacheKey('groq', 'm', other));
  });

  it('separates the same question to two different models', () => {
    const request = { messages: [{ role: 'user' as const, content: 'a' }] };

    expect(cacheKey('groq', 'm1', request)).not.toBe(cacheKey('groq', 'm2', request));
  });
});
