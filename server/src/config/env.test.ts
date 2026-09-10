/**
 * Configuration rules that decide how the system runs.
 *
 * The queue is the one that bites: a missing `REDIS_URL` and a mistyped one
 * both end up running jobs in the API process, and if they also report the
 * same thing an operator goes looking for a variable that is present and
 * wrong.
 */

import { describe, expect, it } from 'vitest';
import { MATCH_CONFIG } from '../utils/scoring.js';
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

  it('defaults retrieval to shadow, so an upgrade changes no behaviour on its own', () => {
    expect(buildEnv(environment()).matching).toMatchObject({
      retrievalMode: 'shadow',
      retrievalLimit: 50,
    });
  });

  it('takes the retrieval mode and limit from the environment', () => {
    expect(
      buildEnv(environment({ RETRIEVAL_MODE: 'on', RETRIEVAL_LIMIT: '120' })).matching,
    ).toMatchObject({ retrievalMode: 'on', retrievalLimit: 120 });
  });

  it('refuses a retrieval mode that is not one of the three', () => {
    expect(() => buildEnv(environment({ RETRIEVAL_MODE: 'enabled' }))).toThrow();
  });

  it('refuses a retrieval limit past the ceiling', () => {
    expect(() => buildEnv(environment({ RETRIEVAL_LIMIT: '5000' }))).toThrow();
  });

  it('defaults the embedding knobs, and takes them from the environment when set', () => {
    expect(buildEnv(environment()).embeddings).toMatchObject({
      enabled: true,
      textModel: 'Xenova/bge-small-en-v1.5',
      textDimensions: 384,
      imageDimensions: 512,
      threads: 1,
      batchSize: 16,
      offline: false,
    });

    expect(
      buildEnv(
        environment({
          EMBEDDING_MODEL: 'Xenova/all-MiniLM-L6-v2',
          EMBEDDING_THREADS: '4',
          EMBEDDING_BATCH_SIZE: '32',
        }),
      ).embeddings,
    ).toMatchObject({ textModel: 'Xenova/all-MiniLM-L6-v2', threads: 4, batchSize: 32 });
  });

  /**
   * `value !== 'false'` and `value === 'true'` are opposite halves of the same
   * mistake. An operator who wrote EMBEDDINGS_OFFLINE=1 into an air-gapped
   * deployment would otherwise get a process that reaches out on first use and
   * says nothing about it.
   */
  it.each([
    ['1', true],
    ['yes', true],
    ['ON', true],
    ['0', false],
    ['no', false],
    ['Off', false],
  ])('reads %s as %s for a flag', (value, expected) => {
    expect(buildEnv(environment({ EMBEDDINGS_OFFLINE: value })).embeddings.offline).toBe(expected);
    expect(buildEnv(environment({ EMBEDDINGS_ENABLED: value })).embeddings.enabled).toBe(expected);
  });

  it('refuses a flag value it cannot read, rather than guessing', () => {
    expect(() => buildEnv(environment({ EMBEDDINGS_OFFLINE: 'maybe' }))).toThrow();
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

describe('retired settings', () => {
  it('says so when RERANK_MODE is still set', () => {
    // Silence would be worse than a warning. An operator who set
    // `RERANK_MODE=off` to stop paying for the reranker would get the opposite
    // of what they asked for: it is the only semantic scorer there is.
    const env = buildEnv(environment({ RERANK_MODE: 'off' }));

    expect(env.warnings.join(' ')).toContain('RERANK_MODE is set to "off" and is no longer read');
  });

  it('stays quiet when it is absent', () => {
    expect(buildEnv(environment()).warnings.join(' ')).not.toContain('RERANK_MODE');
  });
});

describe('the adjudication band', () => {
  it('takes the documented defaults, including the budget chosen against the job timeout', () => {
    expect(buildEnv(environment()).matching).toMatchObject({
      adjudicationMode: 'shadow',
      adjudicationBandLow: 60,
      adjudicationBandHigh: 85,
      adjudicationMaxToolCalls: 8,
      // Chosen against the 120s `match.item` attempt this stage runs inside,
      // which it shares with retrieval, scoring and the rerank.
      adjudicationDeadlineMs: 20_000,
      adjudicationMinConfidence: 70,
    });
  });

  it('starts the band above the match threshold, so the agent demotes rather than promotes', () => {
    const { adjudicationBandLow } = buildEnv(environment()).matching;

    // With the band above the threshold the agent can take a pair out of the
    // matched set or hold it for a person, and cannot add one. Lowering
    // BAND_LOW below the threshold is what surfaces a sub-threshold pair for
    // review, and `.env.example` says so.
    expect(adjudicationBandLow).toBeGreaterThan(MATCH_CONFIG.THRESHOLD);
  });

  it('warns when the band is empty, because nothing would ever be adjudicated', () => {
    const env = buildEnv(
      environment({ ADJUDICATION_BAND_LOW: '85', ADJUDICATION_BAND_HIGH: '60' }),
    );

    expect(env.warnings.join(' ')).toContain('is not below ADJUDICATION_BAND_HIGH');
  });

  it('stays quiet about the band when the agent is switched off', () => {
    const env = buildEnv(
      environment({
        ADJUDICATION_MODE: 'off',
        ADJUDICATION_BAND_LOW: '85',
        ADJUDICATION_BAND_HIGH: '60',
      }),
    );

    expect(env.warnings.join(' ')).not.toContain('ADJUDICATION_BAND_HIGH');
  });
});
