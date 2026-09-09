/**
 * The domain half of embedding: what text stands for an item, and when an item
 * is worth embedding again.
 *
 * The encoders are faked. What matters here is that the same item produces the
 * same string, or the content hash means nothing; that an unchanged item costs
 * nothing; and that a photo nobody can read does not cost the item its text
 * vector, which is the one retrieval actually runs on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const fetchImageBytes = vi.fn(async (_url: string) => Buffer.from('image-bytes') as Buffer | null);

vi.mock('../platform/embeddings/image.source.js', () => ({
  fetchImageBytes: (url: string) => fetchImageBytes(url),
  isFetchableImageUrl: (url: string) => url.startsWith('https://res.cloudinary.com/'),
}));

const { EmbeddingService, composeItemText } = await import('./embedding.service.js');

const TEXT_VECTOR = Float32Array.from([0.1, 0.2, 0.3]);
const IMAGE_VECTOR = Float32Array.from([0.4, 0.5]);

function fakeCache() {
  const store = new Map<string, Float32Array>();

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: Float32Array) => {
      store.set(key, value);
    }),
    clear: vi.fn(),
  };
}

function fakeItems(item: Record<string, unknown> | null, written = true) {
  return {
    findByIdWithVectors: vi.fn(async () => item),
    setEmbeddings: vi.fn(async () => written),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function serviceWith(
  item: Record<string, unknown> | null,
  overrides: {
    text?: { embed: ReturnType<typeof vi.fn> };
    images?: { embedImage: ReturnType<typeof vi.fn> };
    cache?: ReturnType<typeof fakeCache>;
    written?: boolean;
  } = {},
) {
  const items = fakeItems(item, overrides.written ?? true);
  const text = overrides.text ?? { embed: vi.fn(async () => [TEXT_VECTOR]) };
  const images = overrides.images ?? { embedImage: vi.fn(async () => [IMAGE_VECTOR]) };
  const cache = overrides.cache ?? fakeCache();

  const service = new EmbeddingService(items as any, text as any, images as any, cache as any);

  return { service, items, text, images, cache };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const ITEM = {
  id: 'item-1',
  name: 'Black wallet',
  description: 'Found near the library',
  cloudinaryUrls: ['https://res.cloudinary.com/demo/a.jpg'],
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchImageBytes.mockResolvedValue(Buffer.from('image-bytes'));
});

describe('composeItemText', () => {
  it('puts the identifying fields first, because truncation keeps the head', () => {
    const text = composeItemText({
      name: 'Black wallet',
      category: 'Accessories',
      color: 'Black',
      tags: ['leather'],
      description: 'Found near the library entrance',
    });

    expect(text).toBe('Black wallet. Accessories. Black. leather. Found near the library entrance');
  });

  it('sorts tags, so the same set in a different order is the same string', () => {
    const one = composeItemText({ name: 'Bag', tags: ['blue', 'nike', 'sports'] });
    const two = composeItemText({ name: 'Bag', tags: ['sports', 'blue', 'nike'] });

    expect(one).toBe(two);
  });

  it('drops empty fields rather than leaving gaps in the string', () => {
    expect(composeItemText({ name: 'Keys', description: '  ', tags: ['', ' '] })).toBe('Keys');
  });
});

describe('embedItem', () => {
  it('embeds the text and the first image, and stores both', async () => {
    const { service, items, text, images } = serviceWith(ITEM);

    expect(await service.embedItem('item-1')).toBe('embedded');
    expect(text.embed).toHaveBeenCalledTimes(1);
    expect(images.embedImage).toHaveBeenCalledTimes(1);

    const stored = items.setEmbeddings.mock.calls[0][1];

    expect(stored.embedding).toBe(TEXT_VECTOR);
    expect(stored.imageEmbedding).toBe(IMAGE_VECTOR);
    expect(stored.embeddingKey).toMatch(/^emb:/);
  });

  /** The content hash is what makes a re-run, or a moderation flip, free. */
  it('does nothing when the stored hash matches and both vectors are there', async () => {
    const embeddingKey = await keyFor(ITEM);
    const { service, text } = serviceWith({
      ...ITEM,
      embeddingKey,
      embedding: TEXT_VECTOR,
      imageEmbedding: IMAGE_VECTOR,
    });

    expect(await service.embedItem('item-1')).toBe('unchanged');
    expect(text.embed).not.toHaveBeenCalled();
  });

  /**
   * The image half is best effort, so a photo that timed out on the first run
   * leaves the item with a text vector and no image vector. Testing only the
   * text hash would call that finished for good: the approval re-run and the
   * backfill after it would both say `unchanged`.
   */
  it('comes back for an image vector it still owes, even when the text is unchanged', async () => {
    const embeddingKey = await keyFor(ITEM);
    const { service, items, text, images } = serviceWith({
      ...ITEM,
      embeddingKey,
      embedding: TEXT_VECTOR,
    });

    expect(await service.embedItem('item-1')).toBe('embedded');
    // The text vector is reused rather than recomputed: only the image is owed.
    expect(text.embed).not.toHaveBeenCalled();
    expect(images.embedImage).toHaveBeenCalledTimes(1);
    expect(items.setEmbeddings.mock.calls[0][1].imageEmbedding).toBe(IMAGE_VECTOR);
  });

  it('does not come back forever for an item that simply has no photo', async () => {
    const noPhoto = { id: 'item-1', name: 'Keys', description: 'Brass, three of them' };
    const embeddingKey = await keyFor(noPhoto);
    const { service } = serviceWith({ ...noPhoto, embeddingKey, embedding: TEXT_VECTOR });

    expect(await service.embedItem('item-1')).toBe('unchanged');
  });

  it('reports a skip when the item is deleted between the read and the write', async () => {
    const { service } = serviceWith(ITEM, { written: false });

    expect(await service.embedItem('item-1')).toBe('skipped');
  });

  it('re-embeds when the text changed under a stored hash', async () => {
    const embeddingKey = await keyFor(ITEM);
    const { service, text } = serviceWith({
      ...ITEM,
      embeddingKey,
      description: 'Found near the sports hall instead',
    });

    expect(await service.embedItem('item-1')).toBe('embedded');
    expect(text.embed).toHaveBeenCalledTimes(1);
  });

  it('still stores the text vector when the photo cannot be fetched', async () => {
    fetchImageBytes.mockResolvedValue(null);

    const { service, items, images } = serviceWith(ITEM);

    expect(await service.embedItem('item-1')).toBe('embedded');
    expect(images.embedImage).not.toHaveBeenCalled();
    expect(items.setEmbeddings.mock.calls[0][1].embedding).toBe(TEXT_VECTOR);
    expect(items.setEmbeddings.mock.calls[0][1].imageEmbedding).toBeUndefined();
  });

  it('still stores the text vector when the photo cannot be decoded', async () => {
    const images = {
      embedImage: vi.fn(async () => {
        throw new Error('unsupported image');
      }),
    };
    const { service, items } = serviceWith(ITEM, { images });

    expect(await service.embedItem('item-1')).toBe('embedded');
    expect(items.setEmbeddings.mock.calls[0][1].imageEmbedding).toBeUndefined();
  });

  it('reuses a cached image vector without running inference again', async () => {
    const cache = fakeCache();
    const { service } = serviceWith(ITEM, { cache });

    await service.embedItem('item-1');

    const { service: second, images } = serviceWith(ITEM, { cache });

    expect(await second.embedItem('item-1')).toBe('embedded');
    expect(images.embedImage).not.toHaveBeenCalled();
  });

  it('ignores an image URL from a host this deployment does not upload to', async () => {
    const { service, images } = serviceWith({
      ...ITEM,
      cloudinaryUrls: ['https://attacker.test/a.jpg'],
    });

    await service.embedItem('item-1');

    expect(fetchImageBytes).not.toHaveBeenCalled();
    expect(images.embedImage).not.toHaveBeenCalled();
  });

  it('skips an item that has no text at all', async () => {
    const { service, items } = serviceWith({ id: 'item-1', name: '', description: '' });

    expect(await service.embedItem('item-1')).toBe('skipped');
    expect(items.setEmbeddings).not.toHaveBeenCalled();
  });

  it('skips an item that was deleted between the event and the job', async () => {
    const { service, items } = serviceWith(null);

    expect(await service.embedItem('item-1')).toBe('skipped');
    expect(items.setEmbeddings).not.toHaveBeenCalled();
  });
});

describe('embedTexts', () => {
  it('only sends the cache misses to the model', async () => {
    const cache = fakeCache();
    const text = { embed: vi.fn(async (batch: string[]) => batch.map(() => TEXT_VECTOR)) };
    const { service } = serviceWith(null, { cache, text });

    await service.embedTexts(['one', 'two']);
    expect(text.embed).toHaveBeenCalledTimes(1);

    text.embed.mockClear();

    const second = await service.embedTexts(['one', 'two']);

    expect(text.embed).not.toHaveBeenCalled();
    expect(second).toHaveLength(2);
  });

  it('keeps results in the order they were asked for', async () => {
    const cache = fakeCache();
    const first = Float32Array.from([1]);
    const third = Float32Array.from([3]);
    const text = {
      embed: vi.fn(async (batch: string[]) =>
        batch.map((value) => (value === 'a' ? first : third)),
      ),
    };
    const { service } = serviceWith(null, { cache, text });

    // Seed the middle one, so the two misses are not contiguous and a naive
    // splice-back would put them in the wrong slots.
    await service.embedTexts(['b']);
    text.embed.mockClear();

    const result = await service.embedTexts(['a', 'b', 'c']);

    expect(result[0]).toBe(first);
    expect(result[2]).toBe(third);
  });
});

/** The key the service computes for an item, without exporting its internals. */
async function keyFor(item: Record<string, unknown>): Promise<string> {
  const { service, items } = serviceWith(item);

  await service.embedItem('item-1');

  return items.setEmbeddings.mock.calls[0][1].embeddingKey as string;
}
