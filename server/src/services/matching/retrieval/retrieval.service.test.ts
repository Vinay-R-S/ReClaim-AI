/**
 * Stage 1: ordering the candidates the pipeline already filtered.
 *
 * Two properties matter most, and both are things a unit test of either
 * retriever alone would miss.
 *
 * A dense hit is intersected with what the caller filtered, never trusted on
 * its own, because the Firestore query could only enforce equality and the
 * time window and distance limit are ranges.
 *
 * And retrieval orders the field, it does not shrink it. A retriever that
 * matched two of forty candidates must not reduce the field to two: that is
 * the exact hard token-overlap gate the pipeline removed for dropping "iPhone
 * 13" against "Apple phone".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const { RetrievalService } = await import('./retrieval.service.js');

type Candidate = Record<string, unknown> & { id: string };

const NOW = new Date('2026-09-09T12:00:00Z');

function item(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    name: 'Black wallet',
    description: 'Leather, found near the library',
    type: 'Found',
    status: 'Pending',
    date: NOW,
    ...overrides,
  };
}

const SUBJECT = {
  id: 'subject',
  name: 'Black wallet',
  description: 'Leather, lost near the library',
  date: NOW,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function serviceWith(
  options: {
    hits?: Array<{ id: string; distance: number }>;
    subjectVector?: Float32Array | null;
    enabled?: boolean;
  } = {},
) {
  const search = vi.fn(async () => (options.hits ?? []).map((hit) => ({ ...hit, data: {} })));
  const index = { id: 'fake', upsert: vi.fn(), deleteById: vi.fn(), search };

  const embeddings = {
    isEnabled: () => options.enabled ?? true,
    embedTexts: vi.fn(async () => [options.subjectVector ?? Float32Array.from([1, 0])]),
  };

  const items = {
    findByIdWithVectors: vi.fn(async () =>
      options.subjectVector === null ? null : { embedding: options.subjectVector },
    ),
  };

  return {
    service: new RetrievalService(index as any, embeddings as any, items as any),
    index,
    embeddings,
    items,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function eligible(candidates: Candidate[]) {
  return candidates.map((candidate) => ({ item: candidate, date: candidate.date as Date }));
}

async function retrieve(
  candidates: Candidate[],
  options: Parameters<typeof serviceWith>[0] = {},
  limit = 10,
) {
  const parts = serviceWith(options);
  const result = await parts.service.retrieve(SUBJECT, 'Lost', limit, eligible(candidates));

  return { result, ...parts };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the candidate set', () => {
  it('reads nothing of its own: the caller already filtered', async () => {
    const { result, items } = await retrieve([item('a')]);

    // The only repository call is for the subject's own stored vector.
    expect(items.findByIdWithVectors).toHaveBeenCalledTimes(1);
    expect(result.filtered).toBe(1);
  });

  it('returns nothing when the caller offers nothing', async () => {
    const { result, index } = await retrieve([]);

    expect(result).toMatchObject({ candidates: [], filtered: 0, denseUsed: false });
    expect(index.search).not.toHaveBeenCalled();
  });

  /**
   * The regression this exists for. BM25 matching two of forty must not throw
   * the other thirty-eight away; the retrievers order the field, and whatever
   * they did not rank keeps the caller's order behind them.
   */
  it('keeps every candidate when only one retriever matched a few', async () => {
    const candidates = [
      item('phone-a', { name: 'Samsung phone', description: 'black case' }),
      item('phone-b', { name: 'Nokia phone', description: 'blue case' }),
      ...Array.from({ length: 8 }, (_unused, index) =>
        item(`other-${index}`, { name: 'Umbrella', description: 'nothing in common' }),
      ),
    ];

    const { service } = serviceWith({ enabled: false });
    const result = await service.retrieve(
      { ...SUBJECT, name: 'Apple phone', description: 'Apple phone' },
      'Lost',
      10,
      eligible(candidates),
    );

    expect(result.candidates).toHaveLength(10);
    // The lexical hits still lead.
    expect(
      result.candidates
        .slice(0, 2)
        .map((entry) => entry.item.id)
        .sort(),
    ).toEqual(['phone-a', 'phone-b']);
  });

  it('keeps the caller order when neither retriever matches anything', async () => {
    const candidates = [
      item('first', { name: 'zzz', description: 'zzz' }),
      item('second', { name: 'yyy', description: 'yyy' }),
    ];

    const { service } = serviceWith({ enabled: false });
    const result = await service.retrieve(
      { ...SUBJECT, name: 'qqq', description: 'qqq' },
      'Lost',
      10,
      eligible(candidates),
    );

    expect(result.candidates.map((entry) => entry.item.id)).toEqual(['first', 'second']);
  });

  it('respects the requested limit', async () => {
    const candidates = Array.from({ length: 12 }, (_unused, index) => item(`item-${index}`));
    const { result } = await retrieve(candidates, {}, 5);

    expect(result.candidates).toHaveLength(5);
    expect(result.filtered).toBe(12);
  });

  it('never returns a candidate twice', async () => {
    const candidates = [item('a'), item('b')];
    const { result } = await retrieve(candidates, { hits: [{ id: 'a', distance: 0.1 }] });
    const ids = result.candidates.map((entry) => entry.item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the dense half', () => {
  /**
   * Firestore could only pre-filter on equality, so a vector hit still has to
   * be one of the candidates the caller filtered.
   */
  it('ignores a vector hit the caller did not offer', async () => {
    const { result } = await retrieve([item('real')], {
      hits: [{ id: 'ghost', distance: 0.01 }],
    });

    expect(result.candidates.map((entry) => entry.item.id)).toEqual(['real']);
    expect(result.denseUsed).toBe(false);
  });

  it('never returns the subject itself, even as a vector hit', async () => {
    const candidates = [item('subject'), item('other')];
    const { result } = await retrieve(candidates, {
      hits: [{ id: 'subject', distance: 0 }],
    });

    expect(result.candidates.map((entry) => entry.item.id)).not.toContain('subject');
  });

  it('reports cosine similarity, not a rescaled one', async () => {
    const { result } = await retrieve([item('a')], { hits: [{ id: 'a', distance: 0.135 }] });

    expect(result.candidates[0].denseSimilarity).toBeCloseTo(0.865);
    expect(result.candidates[0].ranks).toHaveProperty('dense');
  });

  it('bounds the query by distance, so an unrelated corpus yields no neighbours', async () => {
    const { index } = await retrieve([item('a')]);
    const options = index.search.mock.calls[0][3];

    expect(options.maxDistance).toBeLessThan(0.4);
  });

  /**
   * The query ranks the whole collection and the range limits are applied
   * afterwards, so a k sized only against the output limit intersects to
   * nothing exactly as the corpus grows.
   */
  it('sizes the query against the candidate set as well as the limit', async () => {
    const candidates = Array.from({ length: 300 }, (_unused, index) => item(`item-${index}`));
    const { index } = await retrieve(candidates, {}, 10);

    expect(index.search.mock.calls[0][2]).toBeGreaterThanOrEqual(300);
  });

  it('passes both equality filters, because that is the index that exists', async () => {
    const { index } = await retrieve([item('a')]);

    expect(index.search.mock.calls[0][1]).toEqual({ type: 'Found', status: 'Pending' });
  });

  it('falls back to lexical alone when embeddings are switched off', async () => {
    const { result, index } = await retrieve([item('a')], { enabled: false });

    expect(index.search).not.toHaveBeenCalled();
    expect(result.denseUsed).toBe(false);
    expect(result.candidates).toHaveLength(1);
  });

  /**
   * A report and its matching run leave the same outbox event onto queues
   * consumed concurrently, so a new item usually reaches matching before it
   * has been embedded.
   */
  it('embeds the subject on demand when it has no stored vector yet', async () => {
    const { result, embeddings } = await retrieve([item('a')], {
      subjectVector: null,
      hits: [{ id: 'a', distance: 0.2 }],
    });

    expect(embeddings.embedTexts).toHaveBeenCalledTimes(1);
    expect(result.denseUsed).toBe(true);
  });

  /**
   * The query vector has to come from the same string every stored vector was
   * produced from, or it is drawn from a slightly different point than the
   * documents it is compared against and the content cache can never hit.
   */
  it('embeds the subject with the same composition the stored vectors used', async () => {
    const { embeddings } = await retrieve([item('a')], { subjectVector: null });
    const [text] = embeddings.embedTexts.mock.calls[0][0] as unknown as string[];

    // `composeItemText` joins with '. '; the lexical text joins with spaces.
    expect(text).toContain('. ');
  });
});
