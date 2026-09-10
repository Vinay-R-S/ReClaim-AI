/**
 * Stage 3 as the pipeline drives it.
 *
 * `applyVerdict` is unit-tested next door with its inputs handed to it. What is
 * pinned here is the half nothing else covers: that the agent is asked at all
 * only inside the band, that the mode gate works, that the guards handed to the
 * policy are the same two the threshold filter applies, and that a failure of
 * any kind leaves the deterministic result exactly as it was.
 *
 * The band gate is the cost control for the whole stage. Widened by one
 * comparison it bills an agent run on every match the system makes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const listPendingByType = vi.fn();

vi.mock('../../repositories/item.repository.js', () => ({
  ItemRepository: class {},
  itemRepository: {
    listPendingByType: (...args: unknown[]) => listPendingByType(...args),
  },
}));

const mode = { value: 'on' as 'off' | 'shadow' | 'on' };
const band = { low: 60, high: 85 };

vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>();

  return {
    ...actual,
    env: {
      ...actual.env,
      matching: {
        ...actual.env.matching,
        retrievalMode: 'off',
        get adjudicationMode() {
          return mode.value;
        },
        get adjudicationBandLow() {
          return band.low;
        },
        get adjudicationBandHigh() {
          return band.high;
        },
        adjudicationMinConfidence: 70,
        adjudicationDeadlineMs: 20_000,
      },
    },
  };
});

const { MatchingService } = await import('./matching.pipeline.js');

const SUBJECT = {
  id: 'lost-1',
  name: 'Black leather wallet',
  description: 'Black bifold wallet, initials JR inside',
  color: 'Black',
  category: 'Wallets',
  location: 'Central library',
  date: new Date('2026-09-08T09:00:00Z'),
  tags: ['wallet', 'leather'],
};

function candidate(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Wallet',
    description: 'Dark wallet handed in at the desk',
    type: 'Found',
    status: 'Pending',
    color: 'Black',
    category: 'Wallets',
    location: 'Library steps',
    date: new Date('2026-09-08T12:00:00Z'),
    reportedBy: 'finder-1',
    ...overrides,
  };
}

function traceWith(decision: string, confidence: number) {
  return {
    verdict: { decision, confidence, evidence: [], contradictions: [] },
    lostItemId: 'lost-1',
    foundItemId: 'found-1',
    pipelineScore: 0,
    steps: [],
    toolCalls: 1,
    modelCalls: 2,
    stoppedBy: 'verdict',
    promptVersion: 'adjudicate/v1',
    model: 'test-model',
    provider: 'test',
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0,
    ms: 10,
    mode: 'on',
  };
}

/**
 * A reranker that answers with one score for every candidate, or with nothing.
 *
 * The reranker is the only semantic scorer since the per-pair path was
 * retired, so this is how a test decides where a pair lands.
 */
function rerankerReturning(score: number | null) {
  return {
    rerank: async (subject: unknown, candidates: Array<{ id: string }>) => {
      if (score === null) return null;

      return {
        scores: new Map(
          candidates.map((item) => [
            item.id,
            { id: item.id, score, verdict: 'likely' as const },
          ]),
        ),
        model: 'test-model',
        requested: candidates.length,
        ms: 5,
      };
    },
  };
}

/**
 * Run the pipeline with a semantic score chosen to land the pair on a given
 * final score, so a test can say "this pair is in the band" without arithmetic.
 *
 * Colour, location text and time all apply here, so the semantic weight is not
 * the whole story; the assertions below check the score the pipeline actually
 * produced rather than assuming one.
 */
function run(semantic: number | null, adjudicator: { adjudicate: ReturnType<typeof vi.fn> }) {
  listPendingByType.mockResolvedValue([candidate('found-1')]);

  const service = new MatchingService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reranker: rerankerReturning(semantic) as any,
    visual: { isConfigured: () => false, score: async () => null },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adjudicator: adjudicator as any,
  });

  return service.run(SUBJECT, 'Lost');
}

beforeEach(() => {
  vi.clearAllMocks();
  mode.value = 'on';
  band.low = 60;
  band.high = 85;
});

describe('the band gate', () => {
  it('adjudicates a pair whose score falls inside the band', async () => {
    const adjudicate = vi.fn(async () => traceWith('match', 90));

    const result = await run(70, { adjudicate });

    expect(result.best?.score).toBeGreaterThanOrEqual(60);
    expect(result.best?.score).toBeLessThan(85);
    expect(adjudicate).toHaveBeenCalledTimes(1);
    expect(result.adjudication).not.toBeNull();
  });

  it('does not adjudicate a pair at or above the top of the band', async () => {
    const adjudicate = vi.fn(async () => traceWith('match', 90));

    band.low = 0;
    band.high = 1;

    const result = await run(95, { adjudicate });

    expect(adjudicate).not.toHaveBeenCalled();
    expect(result.adjudication).toBeNull();
    expect(result.adjudicationOutcome).toBe('unchanged');
  });

  it('does not adjudicate a pair below the bottom of the band', async () => {
    const adjudicate = vi.fn(async () => traceWith('match', 90));

    band.low = 99;
    band.high = 100;

    const result = await run(70, { adjudicate });

    expect(adjudicate).not.toHaveBeenCalled();
  });

  it('asks nobody when the mode is off', async () => {
    const adjudicate = vi.fn(async () => traceWith('match', 90));

    mode.value = 'off';

    const result = await run(70, { adjudicate });

    expect(adjudicate).not.toHaveBeenCalled();
    expect(result.adjudication).toBeNull();
  });
});

describe('shadow mode', () => {
  it('runs the agent and records the trace, and moves nothing', async () => {
    const adjudicate = vi.fn(async () => traceWith('no_match', 100));

    mode.value = 'shadow';

    const result = await run(70, { adjudicate });

    expect(adjudicate).toHaveBeenCalledTimes(1);
    expect(result.adjudication).not.toBeNull();
    expect(result.adjudicationOutcome).toBe('unchanged');
    expect(result.matches).toHaveLength(1);
  });
});

describe('acting on a verdict', () => {
  it('removes a pair the agent rejected', async () => {
    const adjudicate = vi.fn(async () => traceWith('no_match', 95));

    const result = await run(70, { adjudicate });

    expect(result.adjudicationOutcome).toBe('discard');
    expect(result.matches).toHaveLength(0);
    // The trace is still returned: the caller needs it to know why, and the
    // pair it names is what decides which record it belongs on.
    expect(result.adjudication).not.toBeNull();
  });

  it('keeps a pair the agent confirmed', async () => {
    const adjudicate = vi.fn(async () => traceWith('match', 95));

    const result = await run(70, { adjudicate });

    expect(result.adjudicationOutcome).toBe('confirm');
    expect(result.matches).toHaveLength(1);
  });

  it('never confirms a pair the reranker could not answer for', async () => {
    // No semantic verdict, so the pair fails the evidence guard and is not a
    // match however sure the agent is. The band still has to be reachable
    // without the semantic weight, so it is widened for this case.
    const adjudicate = vi.fn(async () => traceWith('match', 100));

    band.low = 0;
    band.high = 100;

    const result = await run(null, { adjudicate });

    expect(result.matches).toHaveLength(0);
    expect(result.adjudicationOutcome).not.toBe('confirm');
  });
});

describe('when the agent cannot answer', () => {
  it('leaves the deterministic result standing when it returns nothing', async () => {
    const adjudicate = vi.fn(async () => null);

    const result = await run(70, { adjudicate });

    expect(result.matches).toHaveLength(1);
    expect(result.adjudication).toBeNull();
    expect(result.adjudicationOutcome).toBe('unchanged');
  });

  it('leaves it standing when the agent throws', async () => {
    const adjudicate = vi.fn(async () => {
      throw new Error('no provider');
    });

    const result = await run(70, { adjudicate });

    expect(result.matches).toHaveLength(1);
    expect(result.adjudicationOutcome).toBe('unchanged');
  });

  it('stops waiting rather than letting the matching job time out', async () => {
    // The whole matching run happens inside a job attempt killed at two
    // minutes. An agent that hangs must cost this stage, not the run.
    vi.useFakeTimers();

    try {
      const adjudicate = vi.fn(
        () =>
          new Promise(() => {
            // Never settles.
          }),
      );

      const pending = run(70, { adjudicate } as never);

      await vi.advanceTimersByTimeAsync(30_000);

      const result = await pending;

      expect(result.matches).toHaveLength(1);
      expect(result.adjudicationOutcome).toBe('unchanged');
    } finally {
      vi.useRealTimers();
    }
  });
});
