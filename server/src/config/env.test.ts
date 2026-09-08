/**
 * Configuration rules that decide how the system runs.
 *
 * The queue is the one that bites: a missing `REDIS_URL` and a mistyped one
 * both end up running jobs in the API process, and if they also report the
 * same thing an operator goes looking for a variable that is present and
 * wrong.
 */

import { describe, expect, it } from 'vitest';
import { buildEnv } from './env.js';

/** Enough of an environment to build without tripping an unrelated rule. */
function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: 'development', ...overrides };
}

describe('queue configuration', () => {
  it('is configured by a redis:// or rediss:// URL', () => {
    expect(buildEnv(environment({ REDIS_URL: 'redis://localhost:6379' })).queue).toMatchObject({
      redisUrl: 'redis://localhost:6379',
      isConfigured: true,
    });
    expect(
      buildEnv(environment({ REDIS_URL: 'rediss://cache.example:6380' })).queue.isConfigured,
    ).toBe(true);
  });

  it('is unconfigured, and says so, when the variable is absent', () => {
    const env = buildEnv(environment());

    expect(env.queue.isConfigured).toBe(false);
    expect(env.warnings.join(' ')).toContain('REDIS_URL is not set');
  });

  it('ignores a URL with no scheme, and reports that rather than "not set"', () => {
    const env = buildEnv(environment({ REDIS_URL: 'localhost:6379' }));

    expect(env.queue).toMatchObject({ redisUrl: undefined, isConfigured: false });
    expect(env.warnings.join(' ')).toContain('REDIS_URL is set but is not a redis://');
    expect(env.warnings.join(' ')).not.toContain('REDIS_URL is not set');
  });

  it('ignores a URL with the wrong scheme the same way', () => {
    const env = buildEnv(environment({ REDIS_URL: 'http://localhost:6379' }));

    expect(env.queue.isConfigured).toBe(false);
    expect(env.warnings.join(' ')).toContain('REDIS_URL is set but is not a redis://');
  });

  it('defaults the worker knobs, and takes them from the environment when set', () => {
    expect(buildEnv(environment()).queue).toMatchObject({
      concurrency: 4,
      outboxPollIntervalMs: 2_000,
      outboxBatchSize: 20,
    });

    expect(
      buildEnv(
        environment({
          QUEUE_CONCURRENCY: '8',
          OUTBOX_POLL_INTERVAL_MS: '500',
          OUTBOX_BATCH_SIZE: '50',
        }),
      ).queue,
    ).toMatchObject({ concurrency: 8, outboxPollIntervalMs: 500, outboxBatchSize: 50 });
  });
});
