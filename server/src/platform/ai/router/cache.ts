/**
 * Response cache.
 *
 * Matching re-scores the same pairs constantly: an item that stays Pending is
 * compared against the same counterparts on every run, and the answer for an
 * unchanged pair does not change. The key is a hash of everything that could
 * change the answer, so a hit is safe by construction rather than by policy.
 *
 * Redis when configured so the API and the workers share it, memory otherwise.
 * Both are best effort: a cache failure is a slower call, never a failed one.
 */

import { createHash } from 'node:crypto';
import { createLogger } from '../../../utils/logger.js';
import { getSharedRedis } from '../../redis/shared.js';
import type { ChatRequest, ChatResponse } from '../ports/chat.port.js';

const log = createLogger('ai:cache');

/** Bounded so a long-running worker cannot grow one without limit. */
const MAX_MEMORY_ENTRIES = 500;

interface MemoryEntry {
  value: ChatResponse;
  expiresAt: number;
}

export function cacheKey(providerId: string, model: string, request: ChatRequest): string {
  const material = JSON.stringify({
    providerId,
    model,
    messages: request.messages,
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
    structured: request.structured?.name ?? null,
    // Images decide the answer as much as the prompt does, so they are part of
    // the key. Hashed rather than carried: a base64 image is megabytes.
    images: (request.images ?? []).map((image) =>
      createHash('sha1').update(image.base64).digest('hex'),
    ),
  });

  return `ai:cache:${createHash('sha256').update(material).digest('hex')}`;
}

export class ResponseCache {
  private readonly memory = new Map<string, MemoryEntry>();

  async get(key: string, now = Date.now()): Promise<ChatResponse | null> {
    try {
      // Inside the try: the first call constructs the client, and a
      // construction failure here would escape a path documented as best
      // effort and fail a call the cache was only meant to speed up.
      const redis = getSharedRedis();

      if (redis) {
        const raw = await redis.get(key);

        return raw ? (JSON.parse(raw) as ChatResponse) : null;
      }
    } catch (error) {
      log.debug('Cache read failed', { error });

      return null;
    }

    const entry = this.memory.get(key);

    if (!entry) return null;

    if (entry.expiresAt <= now) {
      this.memory.delete(key);

      return null;
    }

    return entry.value;
  }

  async set(key: string, value: ChatResponse, ttlSeconds: number, now = Date.now()): Promise<void> {
    if (ttlSeconds <= 0) return;

    try {
      const redis = getSharedRedis();

      if (redis) {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);

        return;
      }
    } catch (error) {
      log.debug('Cache write failed', { error });

      return;
    }

    // Oldest first, which is insertion order here: entries are never re-set
    // without a new key, so insertion order is close enough to age.
    if (this.memory.size >= MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next().value;

      if (oldest) this.memory.delete(oldest);
    }

    this.memory.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  }

  /**
   * Drop an entry.
   *
   * Used when a reply turned out to be unusable: caching it would serve the
   * same unusable reply for the rest of the TTL, and the repair that follows
   * writes under a different key, so nothing would ever replace it.
   */
  async delete(key: string): Promise<void> {
    this.memory.delete(key);

    try {
      const redis = getSharedRedis();

      await redis?.del(key);
    } catch (error) {
      log.debug('Cache delete failed', { error });
    }
  }

  clear(): void {
    this.memory.clear();
  }
}
