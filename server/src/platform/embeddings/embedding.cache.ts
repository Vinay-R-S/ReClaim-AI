/**
 * Content-hash keyed vector cache.
 *
 * The key is a hash of the model, its revision and the exact bytes or text
 * that went in, so a hit is safe by construction: the same input through the
 * same model is the same vector. That makes an edit that does not change the
 * description free, a re-upload of the same photo free, and a backfill re-run
 * free rather than a second pass over the whole corpus.
 *
 * Redis when it is configured so the API and the workers share it, memory
 * otherwise. Both are best effort: a cache failure is a slower call, never a
 * failed one.
 */

import { createHash } from 'node:crypto';
import { createLogger } from '../../utils/logger.js';
import { getSharedRedis } from '../redis/shared.js';

const log = createLogger('embeddings:cache');

/** Bounded, so a long-running worker cannot grow one without limit. */
const MAX_MEMORY_ENTRIES = 2_000;

const TTL_SECONDS = 30 * 24 * 60 * 60;

export function contentKey(model: string, revision: string, content: string | Buffer): string {
  const digest = createHash('sha256').update(content).digest('hex');

  return `emb:${model}@${revision}:${digest}`;
}

export class EmbeddingCache {
  private readonly memory = new Map<string, Float32Array>();

  async get(key: string): Promise<Float32Array | null> {
    try {
      const redis = getSharedRedis();

      if (redis) {
        // Base64 of the raw buffer, not JSON: a 384-float vector is 1.5 KB of
        // bytes and about 8 KB as a JSON array of decimals.
        const raw = await redis.get(key);

        return raw ? decode(raw) : null;
      }
    } catch (error) {
      log.debug('Vector cache read failed', { error });

      return null;
    }

    return this.memory.get(key) ?? null;
  }

  async set(key: string, vector: Float32Array): Promise<void> {
    try {
      const redis = getSharedRedis();

      if (redis) {
        await redis.set(key, encode(vector), 'EX', TTL_SECONDS);

        return;
      }
    } catch (error) {
      log.debug('Vector cache write failed', { error });

      return;
    }

    if (this.memory.size >= MAX_MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next().value;

      if (oldest) this.memory.delete(oldest);
    }

    this.memory.set(key, vector);
  }

  clear(): void {
    this.memory.clear();
  }
}

function encode(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
}

function decode(raw: string): Float32Array | null {
  const buffer = Buffer.from(raw, 'base64');

  // A truncated value is a corrupt entry, not a vector. Treated as a miss so
  // the caller recomputes rather than storing something misaligned.
  if (buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) return null;

  const vector = new Float32Array(buffer.byteLength / 4);

  Buffer.from(vector.buffer).set(buffer);

  return vector;
}

export const embeddingCache = new EmbeddingCache();
