/**
 * How the pipeline uses hybrid retrieval, per `RETRIEVAL_MODE`.
 *
 * The property this phase rests on is that `shadow` changes nothing. A
 * retrieval stage that quietly altered which candidates were scored while
 * claiming to be measuring itself would make the measurement worthless and the
 * rollout unsafe, so it is pinned here rather than assumed.
 *
 * The second property is that every failure falls back. Retrieval is an
 * optimisation over a linear scan that already works; it must never be the
 * reason a matching run produces nothing.
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
  itemRepository: {
    listPendingByType: () => listPendingByType(),
    findByIdWithVectors: async () => null,
  },
  ItemRepository: class {},
}));

const mode = vi.fn(() => 'shadow');
const rerankMode = vi.fn(() => 'off');

vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>();

  return {
    ...actual,
    env: {
      ...actual.env,
      matching: {
        ...actual.env.matching,
        get rerankMode() {
          return rerankMode();
        },
      },
    },
  };
});

vi.mock('./retrieval/retrieval.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./retrieval/retrieval.service.js')>();

  return {
    ...actual,
    retrievalMode: () => mode(),
  };
});

const { MatchingService } = await import('./matching.pipeline.js');
const { RetrievalService } = await import('./retrieval/retrieval.service.js');

const NOW = new Date('2026-09-09T12:00:00Z');

function item(id: string, name: string) {
  return {
    id,
    name,
    description: `${name}, reported near the library`,
    type: 'Found',
    status: 'Pending',
    date: NOW,
    color: 'Black',
  };
}

/** Two candidates the legacy ordering and a fake retrieval disagree about. */
const CANDIDATES = [item('lexical-first', 'Black wallet'), item('dense-first', 'Dark billfold')];

const SUBJECT = {
  id: 'subject',
  name: 'Black wallet',
  description: 'Leather, lost near the library',
  color: 'Black',
  date: NOW,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function pipelineWith(retrieved: string[]) {
  const scored: string[] = [];

  const semantic = {
    score: vi.fn(async (_subject: unknown, candidate: any) => {
      scored.push(candidate.id);

      return 90;
    }),
  };

  const visual = { isConfigured: () => false, score: vi.fn(async () => null) };

  const retrieval = {
    retrieve: vi.fn(async () => ({
      candidates: retrieved.map((id) => ({
        item: CANDIDATES.find((candidate) => candidate.id === id),
        denseSimilarity: 0.9,
        ranks: { dense: 1 },
      })),
      filtered: CANDIDATES.length,
      denseUsed: true,
      ms: 3,
    })),
  };

  return {
    service: new MatchingService({
      semantic: semantic as any,
      visual: visual as any,
      retrieval: retrieval as any,
    }),
    retrieval,
    scored,
  };
}

/**
 * The same pipeline with the real retrieval stage behind it.
 *
 * A test that injects a fake `retrieve` can only prove the pipeline ignores
 * what it returns. It cannot notice the real stage reading the collection a
 * second time, spending an inference, or writing anything, which are the ways
 * shadow could stop being a shadow.
 */
function realPipeline() {
  const scored: string[] = [];

  const semantic = {
    score: vi.fn(async (_subject: unknown, candidate: any) => {
      scored.push(candidate.id);

      return 90;
    }),
  };

  const search = vi.fn(async () => []);
  const embedTexts = vi.fn(async () => [Float32Array.from([1, 0])]);
  const findByIdWithVectors = vi.fn(async () => null);

  const retrieval = new RetrievalService(
    { id: 'fake', upsert: vi.fn(), deleteById: vi.fn(), search } as any,
    { isEnabled: () => true, embedTexts } as any,
    { findByIdWithVectors } as any,
  );

  return {
    service: new MatchingService({
      semantic: semantic as any,
      visual: { isConfigured: () => false, score: vi.fn(async () => null) } as any,
      retrieval,
    }),
    scored,
    search,
    embedTexts,
    findByIdWithVectors,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.clearAllMocks();
  listPendingByType.mockResolvedValue(CANDIDATES);
  mode.mockReturnValue('shadow');
  rerankMode.mockReturnValue('off');
});

describe('RETRIEVAL_MODE', () => {
  it('does not run retrieval at all when it is off', async () => {
    mode.mockReturnValue('off');

    const { service, retrieval } = pipelineWith(['dense-first']);

    await service.run(SUBJECT, 'Lost');

    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });

  /**
   * The whole safety argument of the phase: shadow runs the new retrieval and
   * still scores what the old one chose.
   */
  it('runs retrieval in shadow but scores what the previous ordering chose', async () => {
    const { service, retrieval, scored } = pipelineWith(['dense-first']);

    await service.run(SUBJECT, 'Lost');

    expect(retrieval.retrieve).toHaveBeenCalledTimes(1);
    // The legacy lexical ordering puts the exact-wording candidate first and
    // keeps both; retrieval offered only one, and was ignored.
    expect(scored).toContain('lexical-first');
    expect(scored).toHaveLength(2);
  });

  it('scores exactly what retrieval chose when it is on', async () => {
    mode.mockReturnValue('on');

    const { service, scored } = pipelineWith(['dense-first']);

    await service.run(SUBJECT, 'Lost');

    expect(scored).toEqual(['dense-first']);
  });

  it('falls back to the previous ordering when retrieval throws', async () => {
    mode.mockReturnValue('on');

    const { service, retrieval, scored } = pipelineWith([]);

    retrieval.retrieve.mockRejectedValue(new Error('vector index missing'));

    const result = await service.run(SUBJECT, 'Lost');

    expect(scored).toHaveLength(2);
    expect(result.evaluated).toBe(2);
  });

  it('falls back rather than scoring nothing when retrieval finds nothing', async () => {
    mode.mockReturnValue('on');

    const { service, scored } = pipelineWith([]);

    await service.run(SUBJECT, 'Lost');

    expect(scored).toHaveLength(2);
  });

  it('does not let a shadow failure fail the run', async () => {
    const { service, retrieval } = pipelineWith([]);

    retrieval.retrieve.mockRejectedValue(new Error('boom'));

    await expect(service.run(SUBJECT, 'Lost')).resolves.toMatchObject({ evaluated: 2 });
  });

  it('passes the configured limit to retrieval rather than a hardcoded one', async () => {
    const { service, retrieval } = pipelineWith(['dense-first']);

    await service.run(SUBJECT, 'Lost');

    expect(retrieval.retrieve.mock.calls[0][2]).toBe(50);
  });
});

/**
 * The rerank stage, in each mode.
 *
 * Same argument as retrieval: `shadow` must not change a single score, or
 * the numbers it logs describe a system nobody is running.
 */
describe('RERANK_MODE', () => {
  function reranker(scores: Record<string, number>) {
    return {
      rerank: vi.fn(async () => ({
        scores: new Map(
          Object.entries(scores).map(([id, score]) => [
            id,
            { id, score, verdict: 'likely' as const },
          ]),
        ),
        model: 'test-model',
        requested: Object.keys(scores).length,
        ms: 5,
      })),
    };
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function pipeline(batch: Record<string, number>, perPair = 40) {
    const semantic = { score: vi.fn(async () => perPair) };
    const rerank = reranker(batch);

    return {
      service: new MatchingService({
        semantic: semantic as any,
        visual: { isConfigured: () => false, score: vi.fn(async () => null) } as any,
        reranker: rerank as any,
      }),
      semantic,
      rerank,
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it('does not call the reranker at all when it is off', async () => {
    const { service, rerank, semantic } = pipeline({ 'lexical-first': 95 });

    await service.run(SUBJECT, 'Lost');

    expect(rerank.rerank).not.toHaveBeenCalled();
    expect(semantic.score).toHaveBeenCalledTimes(2);
  });

  /**
   * Shadow costs one extra call, not N extra: the batch runs once and every
   * candidate still gets the per-pair call whose score actually counts.
   */
  it('runs the reranker in shadow but scores from the per-pair scorer', async () => {
    rerankMode.mockReturnValue('shadow');

    const { service, rerank, semantic } = pipeline({ 'lexical-first': 95, 'dense-first': 95 });
    const result = await service.run(SUBJECT, 'Lost');

    expect(rerank.rerank).toHaveBeenCalledTimes(1);
    expect(semantic.score).toHaveBeenCalledTimes(2);

    // The per-pair scorer said 40, the batch said 95. The score is the 40.
    const semanticComponent = result.best!.breakdown.semantic;

    expect(Math.round((semanticComponent.score / semanticComponent.weight) * 100)).toBe(40);
  });

  it('produces the same scores in shadow as with the reranker off', async () => {
    rerankMode.mockReturnValue('off');
    const off = await pipeline({ 'lexical-first': 95 }).service.run(SUBJECT, 'Lost');

    rerankMode.mockReturnValue('shadow');
    const shadow = await pipeline({ 'lexical-first': 95 }).service.run(SUBJECT, 'Lost');

    expect(shadow.matches.map((entry) => entry.score)).toEqual(
      off.matches.map((entry) => entry.score),
    );
    expect(shadow.best?.score).toBe(off.best?.score);
  });

  /** The saving: the batch answers, so the per-pair call is not made at all. */
  it('replaces the per-pair calls entirely when it is on', async () => {
    rerankMode.mockReturnValue('on');

    const { service, semantic } = pipeline({ 'lexical-first': 95, 'dense-first': 95 });
    const result = await service.run(SUBJECT, 'Lost');

    expect(semantic.score).not.toHaveBeenCalled();

    // The weighted component, not a round trip back to 0-100: the component is
    // an integer share of a weight of 50, so it carries two points of
    // resolution and 95 stores as 48 rather than as itself.
    const semanticComponent = result.best!.breakdown.semantic;

    expect(semanticComponent.score).toBe(Math.round((95 / 100) * semanticComponent.weight));
  });

  /** A candidate the batch did not answer for still gets its per-pair call. */
  it('falls back per candidate for anything the batch skipped', async () => {
    rerankMode.mockReturnValue('on');

    const { service, semantic } = pipeline({ 'lexical-first': 95 });

    await service.run(SUBJECT, 'Lost');

    expect(semantic.score).toHaveBeenCalledTimes(1);
  });

  it('falls back to the per-pair scorer when the reranker throws', async () => {
    rerankMode.mockReturnValue('on');

    const { service, rerank, semantic } = pipeline({});

    rerank.rerank.mockRejectedValue(new Error('provider down'));

    const result = await service.run(SUBJECT, 'Lost');

    expect(semantic.score).toHaveBeenCalledTimes(2);
    expect(result.evaluated).toBe(2);
  });

  it('falls back when the reranker answers nothing', async () => {
    rerankMode.mockReturnValue('on');

    const { service, rerank, semantic } = pipeline({});

    rerank.rerank.mockResolvedValue(null);

    await service.run(SUBJECT, 'Lost');

    expect(semantic.score).toHaveBeenCalledTimes(2);
  });
});

describe('shadow, against the real retrieval stage', () => {
  /**
   * The property the whole rollout rests on, tested where it can actually
   * fail: the same subject through `off` and through `shadow` must produce
   * the same result, scoring the same candidates in the same order.
   */
  it('produces exactly the same result as off', async () => {
    mode.mockReturnValue('off');

    const off = realPipeline();
    const offResult = await off.service.run(SUBJECT, 'Lost');

    mode.mockReturnValue('shadow');

    const shadow = realPipeline();
    const shadowResult = await shadow.service.run(SUBJECT, 'Lost');

    expect(shadow.scored).toEqual(off.scored);
    expect(shadowResult.evaluated).toBe(offResult.evaluated);
    expect(shadowResult.matches.map((entry) => entry.item.id)).toEqual(
      offResult.matches.map((entry) => entry.item.id),
    );
    expect(shadowResult.best?.item.id).toBe(offResult.best?.item.id);
  });

  /**
   * Retrieval used to query the pending collection itself, which doubled the
   * Firestore reads of every matching run to rebuild a subset of the list the
   * pipeline already held.
   */
  it('reads the pending collection once, not twice', async () => {
    mode.mockReturnValue('shadow');

    const { service } = realPipeline();

    await service.run(SUBJECT, 'Lost');

    expect(listPendingByType).toHaveBeenCalledTimes(1);
  });

  it('still reads it once when the mode is on', async () => {
    mode.mockReturnValue('on');

    const { service } = realPipeline();

    await service.run(SUBJECT, 'Lost');

    expect(listPendingByType).toHaveBeenCalledTimes(1);
  });

  it('scores the whole field when neither retriever matches anything', async () => {
    mode.mockReturnValue('on');

    const { service, scored } = realPipeline();

    // The subject shares no token with either candidate, and the fake index
    // returns no neighbours, so both retrievers come up empty.
    await service.run({ ...SUBJECT, name: 'qqq', description: 'qqq' }, 'Lost');

    expect(scored).toHaveLength(2);
  });
});
