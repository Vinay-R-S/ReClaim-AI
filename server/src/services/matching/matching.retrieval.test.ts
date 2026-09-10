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

vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>();

  return {
    ...actual,
    env: {
      ...actual.env,
      matching: { ...actual.env.matching, adjudicationMode: 'off' },
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
    rerank: vi.fn(async (_subject: unknown, candidates: any[]) => {
      candidates.forEach((candidate) => scored.push(candidate.id));

      return {
        scores: new Map(
          candidates.map((candidate) => [
            candidate.id,
            { id: candidate.id, score: 90, verdict: 'likely' as const },
          ]),
        ),
        model: 'test-model',
        requested: candidates.length,
        ms: 5,
      };
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
      reranker: semantic as any,
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
    rerank: vi.fn(async (_subject: unknown, candidates: any[]) => {
      candidates.forEach((candidate) => scored.push(candidate.id));

      return {
        scores: new Map(
          candidates.map((candidate) => [
            candidate.id,
            { id: candidate.id, score: 90, verdict: 'likely' as const },
          ]),
        ),
        model: 'test-model',
        requested: candidates.length,
        ms: 5,
      };
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
      reranker: semantic as any,
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
 * The rerank stage, which is the only semantic scorer there is.
 *
 * The per-pair scorer it used to be measured against is gone, and with it the
 * fallback that caught a rerank failure. What replaces those tests is the
 * behaviour that now matters: a candidate the batch answered for is scored
 * from that answer, and a candidate it did not answer for is a candidate and
 * never a match, however well it scores on colour, place and time.
 */
describe('rerank', () => {
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
  function pipeline(batch: Record<string, number>) {
    const rerank = reranker(batch);

    return {
      service: new MatchingService({
        visual: { isConfigured: () => false, score: vi.fn(async () => null) } as any,
        reranker: rerank as any,
        // Injected so these tests do not run the real retrieval stage, which
        // would pull in the embeddings stack and make them depend on whatever
        // a developer has EMBEDDINGS_ENABLED set to.
        retrieval: { retrieve: vi.fn(async () => ({ candidates: [], filtered: 0, denseUsed: false, ms: 0 })) } as any,
      }),
      rerank,
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /** One call for the whole field, which is the saving the stage exists for. */
  it('asks once for every candidate rather than once per candidate', async () => {
    const { service, rerank } = pipeline({ 'lexical-first': 95, 'dense-first': 95 });

    await service.run(SUBJECT, 'Lost');

    expect(rerank.rerank).toHaveBeenCalledTimes(1);
    expect(rerank.rerank.mock.calls[0][1]).toHaveLength(2);
  });

  it('scores a candidate from the verdict the batch gave it', async () => {
    const { service } = pipeline({ 'lexical-first': 95, 'dense-first': 95 });

    const result = await service.run(SUBJECT, 'Lost');

    // The weighted component, not a round trip back to 0-100: the component is
    // an integer share of a weight of 50, so it carries two points of
    // resolution and 95 stores as 48 rather than as itself.
    const semantic = result.best!.breakdown.semantic;

    expect(semantic.applicable).toBe(true);
    expect(semantic.score).toBe(Math.round((95 / 100) * semantic.weight));
  });

  it('leaves a candidate the batch skipped without a semantic component', async () => {
    const { service } = pipeline({ 'lexical-first': 95 });

    const result = await service.run(SUBJECT, 'Lost');
    const skipped = result.matches.find((entry) => entry.item.id === 'dense-first');

    // Evaluated, ranked, and not a match: nothing established it is the same
    // object, and place and time alone cannot establish that.
    expect(result.evaluated).toBe(2);
    expect(skipped).toBeUndefined();
  });

  it('produces candidates and no matches when the reranker throws', async () => {
    const { service, rerank } = pipeline({});

    rerank.rerank.mockRejectedValue(new Error('provider down'));

    const result = await service.run(SUBJECT, 'Lost');

    // The safe direction, and the same one a provider outage already took
    // before the per-pair scorer was retired: two reports in the same place at
    // the same time are not the same object.
    expect(result.evaluated).toBe(2);
    expect(result.matches).toHaveLength(0);
  });

  /**
   * Normalising over the components that applied is right, and it means an
   * unanswered candidate is scored out of a smaller denominator than an
   * answered one. 44 of 50 reads as 88; the same evidence plus a reranked 85
   * reads as 86. So the highest number in a run is not necessarily a candidate
   * anybody assessed, and `best` has to be the one that was.
   */
  it('does not call an unassessed candidate the best, however well it scores', async () => {
    const { service } = pipeline({ 'lexical-first': 60 });

    const result = await service.run(SUBJECT, 'Lost');

    expect(result.best?.item.id).toBe('lexical-first');
    expect(result.best?.breakdown.semantic.applicable).toBe(true);
  });

  it('has no best candidate at all when nothing was assessed', async () => {
    const { service } = pipeline({});

    const result = await service.run(SUBJECT, 'Lost');

    // Writing a score here would stamp the item with a percentage for a pair
    // on which nothing checked whether the two objects are the same thing.
    expect(result.evaluated).toBe(2);
    expect(result.best).toBeNull();
  });

  it('produces candidates and no matches when the reranker answers nothing', async () => {
    const { service, rerank } = pipeline({});

    rerank.rerank.mockResolvedValue(null);

    const result = await service.run(SUBJECT, 'Lost');

    expect(result.evaluated).toBe(2);
    expect(result.matches).toHaveLength(0);
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
