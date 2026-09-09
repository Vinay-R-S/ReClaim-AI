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
