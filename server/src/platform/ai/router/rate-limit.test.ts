/**
 * The per-provider rate budget, and the shared client it reads.
 *
 * The reason this file exists is one `await`. `getSharedRedis()` became async
 * so that the first command of a process waits for the socket instead of
 * racing it; drop the `await` at the call site and the result is a truthy
 * Promise, `redis.incr is not a function` throws, the surrounding catch
 * swallows it, and the limiter silently allows every call forever. That is the
 * same class of silent failure the gate was written to fix, and nothing else
 * in the suite would notice it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedRedis = vi.fn();

vi.mock('../../redis/shared.js', () => ({
  getSharedRedis: () => sharedRedis(),
}));

const { RateLimiter } = await import('./rate-limit.js');

/** Just the two commands the limiter uses. */
function fakeRedis(counts: number[] = []) {
  const queue = [...counts];

  return {
    incr: vi.fn(async () => queue.shift() ?? 1),
    expire: vi.fn(async () => 1),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RateLimiter', () => {
  it('counts against Redis when it is available', async () => {
    const redis = fakeRedis([1]);

    sharedRedis.mockResolvedValue(redis);

    await expect(new RateLimiter(5).tryAcquire('groq')).resolves.toBe(true);
    expect(redis.incr).toHaveBeenCalledTimes(1);
  });

  it('awaits the client rather than using the promise it returns', async () => {
    // Without the await, `redis.incr` is undefined, the catch swallows the
    // TypeError, and the limiter allows a call it should have counted.
    const redis = fakeRedis([1]);

    sharedRedis.mockResolvedValue(redis);

    await new RateLimiter(5).tryAcquire('groq');

    expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('ai:rate:groq:'));
  });

  it('refuses once the window count passes the limit', async () => {
    const limiter = new RateLimiter(2);

    sharedRedis.mockResolvedValue(fakeRedis([3]));

    await expect(limiter.tryAcquire('groq')).resolves.toBe(false);
  });

  it('sets an expiry only on the call that opened the window', async () => {
    const redis = fakeRedis([1, 2]);
    const limiter = new RateLimiter(5);

    sharedRedis.mockResolvedValue(redis);

    await limiter.tryAcquire('groq');
    await limiter.tryAcquire('groq');

    expect(redis.expire).toHaveBeenCalledTimes(1);
  });

  it('counts in memory when Redis is not configured', async () => {
    sharedRedis.mockResolvedValue(null);

    const limiter = new RateLimiter(1);

    await expect(limiter.tryAcquire('groq')).resolves.toBe(true);
    await expect(limiter.tryAcquire('groq')).resolves.toBe(false);
  });

  it('allows the call rather than failing it when Redis errors', async () => {
    sharedRedis.mockResolvedValue({
      incr: vi.fn(async () => {
        throw new Error('down');
      }),
      expire: vi.fn(),
    });

    await expect(new RateLimiter(1).tryAcquire('groq')).resolves.toBe(true);
  });

  it('is disabled by a limit of zero, and does not touch Redis at all', async () => {
    await expect(new RateLimiter(0).tryAcquire('groq')).resolves.toBe(true);
    expect(sharedRedis).not.toHaveBeenCalled();
  });
});
