/**
 * The vector cache, and the shared client it reads.
 *
 * Same reason as `rate-limit.test.ts`: `getSharedRedis()` is async so the
 * first command of a process waits for the socket rather than racing it, and
 * a dropped `await` turns into a swallowed TypeError and a permanent silent
 * miss. A cache that always misses is expensive rather than broken, which is
 * exactly why nothing would have noticed.
 *
 * The encoding is worth pinning too: a 384-float vector is 1.5 KB of bytes and
 * about 8 KB as a JSON array of decimals, so it is stored as base64 of the raw
 * buffer and has to survive the round trip exactly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedRedis = vi.fn();

vi.mock('../redis/shared.js', () => ({
  getSharedRedis: () => sharedRedis(),
}));

const { EmbeddingCache } = await import('./embedding.cache.js');

function fakeRedis() {
  const store = new Map<string, string>();

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);

      return 'OK';
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EmbeddingCache', () => {
  it('round trips a vector through Redis without losing precision', async () => {
    const redis = fakeRedis();

    sharedRedis.mockResolvedValue(redis);

    const cache = new EmbeddingCache();
    const vector = Float32Array.from([0.125, -0.5, 0.875, 1]);

    await cache.set('key', vector);

    expect(redis.set).toHaveBeenCalledTimes(1);
    await expect(cache.get('key')).resolves.toEqual(vector);
  });

  it('awaits the client rather than using the promise it returns', async () => {
    const redis = fakeRedis();

    sharedRedis.mockResolvedValue(redis);

    await new EmbeddingCache().get('key');

    expect(redis.get).toHaveBeenCalledWith('key');
  });

  it('misses rather than throwing when the key is absent', async () => {
    sharedRedis.mockResolvedValue(fakeRedis());

    await expect(new EmbeddingCache().get('nothing')).resolves.toBeNull();
  });

  it('falls back to process memory when Redis is not configured', async () => {
    sharedRedis.mockResolvedValue(null);

    const cache = new EmbeddingCache();
    const vector = Float32Array.from([1, 0]);

    await cache.set('key', vector);

    await expect(cache.get('key')).resolves.toEqual(vector);
  });

  it('misses rather than failing the caller when Redis errors', async () => {
    sharedRedis.mockResolvedValue({
      get: vi.fn(async () => {
        throw new Error('down');
      }),
      set: vi.fn(async () => {
        throw new Error('down');
      }),
    });

    const cache = new EmbeddingCache();

    await expect(cache.set('key', Float32Array.from([1]))).resolves.toBeUndefined();
    await expect(cache.get('key')).resolves.toBeNull();
  });
});
