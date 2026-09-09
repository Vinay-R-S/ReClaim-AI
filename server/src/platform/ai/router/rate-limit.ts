/**
 * Per-provider request budget.
 *
 * A provider's own 429 is a poor place to discover a limit: it costs a round
 * trip, it is counted against the account, and on a free tier it can mean a
 * cooldown measured in minutes. This refuses locally first.
 *
 * Redis when it is configured, because the budget belongs to the account and
 * the account is shared by the API and every worker. Process memory otherwise,
 * which is right for one process and wrong in the safe direction for several:
 * each keeps its own allowance and the total can exceed the limit, so the
 * provider's 429 stays the backstop it always was.
 */

import { createLogger } from '../../../utils/logger.js';
import { getSharedRedis } from '../../redis/shared.js';

const log = createLogger('ai:ratelimit');

const WINDOW_SECONDS = 60;

interface MemoryWindow {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, MemoryWindow>();

  constructor(private readonly limitPerMinute: number) {}

  /**
   * Take one request from this minute's allowance.
   *
   * A Redis failure allows the call: the limiter is protection against waste,
   * not a security control, and refusing real work because a cache is down
   * would be the worse failure.
   */
  async tryAcquire(key: string, now = Date.now()): Promise<boolean> {
    if (this.limitPerMinute <= 0) return true;

    const bucket = Math.floor(now / (WINDOW_SECONDS * 1000));

    try {
      const redis = getSharedRedis();

      if (redis) {
        const redisKey = `ai:rate:${key}:${bucket}`;
        const count = await redis.incr(redisKey);

        if (count === 1) await redis.expire(redisKey, WINDOW_SECONDS * 2);

        return count <= this.limitPerMinute;
      }
    } catch (error) {
      log.warn('Rate limit check failed, allowing the call', { key, error });

      return true;
    }

    const resetAt = (bucket + 1) * WINDOW_SECONDS * 1000;
    const window = this.windows.get(key);

    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt });

      return true;
    }

    window.count += 1;

    return window.count <= this.limitPerMinute;
  }

  reset(): void {
    this.windows.clear();
  }
}
