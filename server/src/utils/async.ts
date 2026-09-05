/**
 * Async helpers for calls to third-party services.
 *
 * Every LLM and vision call in the matching pipeline goes through these, so a
 * slow or flapping provider costs a bounded amount of time and money instead of
 * one unbounded fan-out per request.
 */

import { createLogger } from './logger.js';

const log = createLogger('async');

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Reject when `promise` has not settled within `ms`.
 *
 * The underlying work is not cancelled, only abandoned: callers pass an
 * `AbortSignal` of their own where the transport supports one.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export interface RetryOptions {
  attempts?: number;
  /** Delay before the first retry. Doubles each attempt. */
  baseDelayMs?: number;
  label?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Run `task`, retrying with exponential backoff.
 *
 * Retries are for transient transport failures. The caller decides what a
 * failure means: this rethrows the last error rather than inventing a value.
 */
export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseDelayMs = 250, label = 'task' } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) break;

      const wait = baseDelayMs * 2 ** (attempt - 1);
      log.debug(`${label} failed on attempt ${attempt}/${attempts}, retrying in ${wait}ms`);
      await delay(wait);
    }
  }

  throw lastError;
}

/**
 * Map over `items` with at most `limit` tasks in flight.
 *
 * Results keep input order. `Promise.all` over a whole candidate list was the
 * shape that turned one search request into one LLM call per pending item.
 *
 * A failing task stops the drain: the remaining workers finish what they are
 * holding and take nothing new, so a rejected map does not keep spending on
 * third-party calls whose results are already being discarded.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const size = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;

  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      if (failed) return;

      const index = cursor;
      cursor += 1;

      if (index >= items.length) return;

      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });

  await Promise.all(workers);

  return results;
}

/**
 * A counting semaphore for work that is not a single array pass.
 *
 * `mapWithConcurrency` caps one batch; this caps everything routed through it,
 * which is what a cache shared across concurrent callers needs.
 */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  const size = Math.max(1, limit);
  const waiting: Array<() => void> = [];
  let active = 0;

  function release(): void {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  }

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= size) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }

    active += 1;

    try {
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * Wrap an async producer so concurrent callers share one in-flight call.
 *
 * Without this a cold cache plus a fan-out of N scorers issues N identical
 * reads, which is what made the provider-setting lookup scale with candidates.
 */
export function singleFlight<T>(producer: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;

  return () => {
    if (inFlight) return inFlight;

    inFlight = producer().finally(() => {
      inFlight = null;
    });

    return inFlight;
  };
}
