/**
 * The Firestore vector adapter.
 *
 * This is the one file in the retrieval path that touches Firestore, and every
 * failure it has is silent by design: a missing index, a hit with no distance
 * and a query that returns nothing all end up as an empty array, because
 * retrieval must never be the reason a matching run fails. Silent failure is
 * the right behaviour and exactly why the branches need pinning.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: {},
  auth: {},
  collections: { items: {} },
  default: {},
}));

const { FirestoreVectorIndex, resetVectorIndexWarnings } =
  await import('./firestore.vector.index.js');

const VECTOR = Float32Array.from([0.1, 0.2, 0.3]);

interface Doc {
  id: string;
  data: Record<string, unknown>;
}

function fakeCollection(options: { docs?: Doc[]; error?: unknown } = {}) {
  const findNearest = vi.fn(() => ({
    get: async () => {
      if (options.error) throw options.error;

      return {
        docs: (options.docs ?? []).map((doc) => ({
          id: doc.id,
          // A fresh object per call, as Firestore does.
          data: () => ({ ...doc.data }),
        })),
      };
    },
  }));

  const where = vi.fn(function chain(this: unknown) {
    return collection;
  });

  const update = vi.fn(async () => undefined);
  const set = vi.fn(async () => undefined);
  const doc = vi.fn(() => ({ update, set }));

  const collection = { where, findNearest, doc };

  return { collection, where, findNearest, doc, update, set };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function indexOver(options: Parameters<typeof fakeCollection>[0] = {}) {
  const parts = fakeCollection(options);

  return { index: new FirestoreVectorIndex(parts.collection as any), ...parts };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const FILTERS = { type: 'Found', status: 'Pending' };

beforeEach(() => {
  vi.clearAllMocks();
  resetVectorIndexWarnings();
});

describe('search', () => {
  it('applies both equality filters and asks for cosine distance', async () => {
    const { index, where, findNearest } = indexOver();

    await index.search(VECTOR, FILTERS, 10);

    expect(where).toHaveBeenCalledWith('type', '==', 'Found');
    expect(where).toHaveBeenCalledWith('status', '==', 'Pending');
    expect(findNearest.mock.calls[0][0]).toMatchObject({
      vectorField: 'embedding',
      limit: 10,
      distanceMeasure: 'COSINE',
    });
  });

  it('clamps the limit to what Firestore accepts', async () => {
    const { index, findNearest } = indexOver();

    await index.search(VECTOR, FILTERS, 99_999);

    expect(findNearest.mock.calls[0][0].limit).toBe(1000);
  });

  it('reads the distance the query was told to write', async () => {
    const { index } = indexOver({
      docs: [{ id: 'a', data: { __vectorDistance: 0.25, name: 'Wallet' } }],
    });

    const [hit] = await index.search(VECTOR, FILTERS, 10);

    expect(hit).toMatchObject({ id: 'a', distance: 0.25 });
  });

  /**
   * The vectors are on the document, and a hit carries the document so that
   * using it costs no second read. Several hundred floats per hit is payload
   * nobody asked for, and the item repository strips them for the same reason.
   */
  it('strips the vectors and the query artefact off the payload', async () => {
    const { index } = indexOver({
      docs: [
        {
          id: 'a',
          data: {
            __vectorDistance: 0.2,
            embedding: [1, 2, 3],
            imageEmbedding: [4, 5],
            name: 'Wallet',
          },
        },
      ],
    });

    const [hit] = await index.search(VECTOR, FILTERS, 10);

    expect(hit.data).toEqual({ name: 'Wallet' });
  });

  /**
   * Reading a missing distance as 0 would make an unranked document the
   * nearest possible neighbour, which is worse than dropping it.
   */
  it('drops a hit that carries no distance rather than calling it a perfect match', async () => {
    const { index } = indexOver({ docs: [{ id: 'a', data: { name: 'Wallet' } }] });

    expect(await index.search(VECTOR, FILTERS, 10)).toEqual([]);
  });

  it('drops a hit whose distance is not a number', async () => {
    const { index } = indexOver({
      docs: [{ id: 'a', data: { __vectorDistance: 'near' } }],
    });

    expect(await index.search(VECTOR, FILTERS, 10)).toEqual([]);
  });

  /** The SDK drops a `distanceThreshold` of 0 as falsy, so the bound is ours too. */
  it('enforces the distance bound itself, not only through the query', async () => {
    const { index } = indexOver({
      docs: [
        { id: 'near', data: { __vectorDistance: 0.1 } },
        { id: 'far', data: { __vectorDistance: 0.9 } },
      ],
    });

    const hits = await index.search(VECTOR, FILTERS, 10, { maxDistance: 0.35 });

    expect(hits.map((hit) => hit.id)).toEqual(['near']);
  });

  it('passes the bound to the query as well, so the far end can use it', async () => {
    const { index, findNearest } = indexOver();

    await index.search(VECTOR, FILTERS, 10, { maxDistance: 0.35 });

    expect(findNearest.mock.calls[0][0].distanceThreshold).toBe(0.35);
  });

  it('omits the threshold entirely when none was asked for', async () => {
    const { index, findNearest } = indexOver();

    await index.search(VECTOR, FILTERS, 10);

    expect(findNearest.mock.calls[0][0]).not.toHaveProperty('distanceThreshold');
  });

  it('can search the image vector instead', async () => {
    const { index, findNearest } = indexOver();

    await index.search(VECTOR, FILTERS, 10, { field: 'imageEmbedding' });

    expect(findNearest.mock.calls[0][0].vectorField).toBe('imageEmbedding');
  });
});

describe('when the index is missing', () => {
  const missing = Object.assign(new Error('no matching index found'), { code: 9 });

  it('returns nothing rather than failing the matching run', async () => {
    const { index } = indexOver({ error: missing });

    expect(await index.search(VECTOR, FILTERS, 10)).toEqual([]);
  });

  /**
   * Every matching run hits this until the index is deployed. One error line
   * per report would be an alert storm on a release that changed nothing.
   */
  it('says so once per process, not once per run', async () => {
    const { index } = indexOver({ error: missing });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await index.search(VECTOR, FILTERS, 10);
    await index.search(VECTOR, FILTERS, 10);
    await index.search(VECTOR, FILTERS, 10);

    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('returns nothing for any other failure too', async () => {
    const { index } = indexOver({ error: new Error('deadline exceeded') });

    expect(await index.search(VECTOR, FILTERS, 10)).toEqual([]);
  });
});

describe('upsert and deleteById', () => {
  /** The port says upsert, and `update` rejects a document that is not there. */
  it('merges rather than updating, so a missing document is not an error', async () => {
    const { index, set, update } = indexOver();

    await index.upsert('a', VECTOR);

    expect(set).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(set.mock.calls[0][1]).toEqual({ merge: true });
  });

  /**
   * The stored hash describes the text the embedding service derived a vector
   * from. A vector written through this port did not come from there, so
   * leaving the hash would tell the backfill the item was already up to date.
   */
  it('clears the content hash, so the backfill still reconciles the item', async () => {
    const { index, set } = indexOver();

    await index.upsert('a', VECTOR);

    expect(set.mock.calls[0][0]).toHaveProperty('embeddingKey');
  });

  it('treats a document that is already gone as successfully de-indexed', async () => {
    const { index, update } = indexOver();

    update.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 5 }));

    await expect(index.deleteById('a')).resolves.toBeUndefined();
  });

  it('still raises anything that is not a missing document', async () => {
    const { index, update } = indexOver();

    update.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 7 }));

    await expect(index.deleteById('a')).rejects.toThrow('permission denied');
  });

  it('clears every field that described the vector, not just the vector', async () => {
    const { index, update } = indexOver();

    await index.deleteById('a');

    expect(Object.keys(update.mock.calls[0][0]).sort()).toEqual([
      'embeddedAt',
      'embedding',
      'embeddingKey',
      'embeddingModel',
      'imageEmbedding',
      'imageEmbeddingModel',
    ]);
  });
});
