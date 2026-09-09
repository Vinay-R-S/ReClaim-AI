/**
 * Turning an item into vectors.
 *
 * This is the domain half of the embedding work: which of an item's fields
 * describe it, in what order, and what gets stored. The encoders themselves
 * know nothing about items, and this knows nothing about ONNX.
 *
 * An item is embedded once in its lifetime unless its text actually changes,
 * which is what the content hash on the document is for: a moderation flag
 * flipping, a match score being written or a re-run of the backfill all leave
 * the hash alone and cost nothing.
 */

import {
  itemRepository,
  ItemRepository,
  type StoredItemWithVectors,
} from '../repositories/item.repository.js';
import {
  embeddingCache,
  contentKey,
  EmbeddingCache,
} from '../platform/embeddings/embedding.cache.js';
import { fetchImageBytes, isFetchableImageUrl } from '../platform/embeddings/image.source.js';
import { imageModel, textModel } from '../platform/embeddings/models.js';
import { imageEmbedder, OnnxImageEmbedder } from '../platform/embeddings/image.embedder.js';
import { textEmbedder, OnnxTextEmbedder } from '../platform/embeddings/text.embedder.js';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embedding.service');

export type EmbeddingOutcome = 'embedded' | 'unchanged' | 'skipped' | 'disabled';

/**
 * The text that stands for an item.
 *
 * Ordered most distinguishing first, because a truncated input keeps its head:
 * the name and category identify a thing, the description qualifies it. Tags
 * are sorted so that the same set in a different order is the same string and
 * therefore the same cache key.
 */
export function composeItemText(item: {
  name?: string;
  category?: string;
  color?: string;
  tags?: string[];
  description?: string;
}): string {
  const tags = [...(item.tags ?? [])]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .sort();

  return [
    item.name?.trim(),
    item.category?.trim(),
    item.color?.trim(),
    tags.length > 0 ? tags.join(', ') : undefined,
    item.description?.trim(),
  ]
    .filter((part): part is string => Boolean(part))
    .join('. ');
}

export class EmbeddingService {
  constructor(
    private readonly items: ItemRepository = itemRepository,
    private readonly text: OnnxTextEmbedder = textEmbedder,
    private readonly images: OnnxImageEmbedder = imageEmbedder,
    private readonly cache: EmbeddingCache = embeddingCache,
  ) {}

  isEnabled(): boolean {
    return env.embeddings.enabled;
  }

  /**
   * Embed one item and persist the result.
   *
   * The image half is best effort on purpose. A photo that cannot be fetched
   * or decoded must not cost the item its text vector, because the text vector
   * is what retrieval runs on and the image vector is an additional signal.
   */
  async embedItem(itemId: string): Promise<EmbeddingOutcome> {
    if (!this.isEnabled()) return 'disabled';

    const item = await this.items.findByIdWithVectors(itemId);

    if (!item) {
      log.warn('Nothing to embed, the item is gone', { itemId });

      return 'skipped';
    }

    const spec = textModel();
    const content = composeItemText(item);

    if (!content) {
      log.warn('Item has no text to embed', { itemId });

      return 'skipped';
    }

    const key = contentKey(spec.id, spec.revision, content);

    // The text hash alone is not enough to call an item done. The image half
    // is best effort, so a photo that 503'd or timed out on the first run
    // leaves the item with a text vector and no image vector, and a test on
    // the text hash would call that finished forever: the approval re-run, and
    // the backfill after it, would both say `unchanged`. The same goes for a
    // photo added to a report whose description never changed.
    const owed = this.owesImageVector(item);

    if (item.embeddingKey === key && !owed) return 'unchanged';

    const vector =
      item.embeddingKey === key && item.embedding
        ? item.embedding
        : await this.embedText(content, key);

    const imageVector = await this.embedFirstImage(item);

    const written = await this.items.setEmbeddings(itemId, {
      embedding: vector,
      embeddingKey: key,
      embeddingModel: `${spec.id}@${spec.revision}`,
      imageEmbedding: imageVector,
      imageEmbeddingModel: imageVector ? `${imageModel().id}@${imageModel().revision}` : undefined,
    });

    if (!written) {
      log.warn('Item was deleted while it was being embedded', { itemId });

      return 'skipped';
    }

    log.info('Item embedded', { itemId, withImage: Boolean(imageVector) });

    return 'embedded';
  }

  /**
   * Embed many texts at once, reading through the cache.
   *
   * Only the misses reach the model, and they go as one batch rather than one
   * call each: the per-call overhead of an ONNX session dominates the actual
   * inference at these sizes.
   */
  async embedTexts(texts: string[]): Promise<Float32Array[]> {
    const spec = textModel();
    const keys = texts.map((text) => contentKey(spec.id, spec.revision, text));
    const cached = await Promise.all(keys.map((key) => this.cache.get(key)));

    const missing = texts
      .map((text, index) => ({ text, index }))
      .filter(({ index }) => cached[index] === null);

    if (missing.length === 0) return cached as Float32Array[];

    const computed: Float32Array[] = [];

    for (let start = 0; start < missing.length; start += env.embeddings.batchSize) {
      const batch = missing.slice(start, start + env.embeddings.batchSize);

      // Sequential batches, not parallel: the model is one session pinned to a
      // fixed thread count, so overlapping batches queue on the same threads
      // and only add memory.
      computed.push(...(await this.text.embed(batch.map((entry) => entry.text))));
    }

    await Promise.all(
      missing.map((entry, position) => this.cache.set(keys[entry.index], computed[position])),
    );

    const result = [...cached] as (Float32Array | null)[];

    missing.forEach((entry, position) => {
      result[entry.index] = computed[position];
    });

    return result as Float32Array[];
  }

  /** An item with a usable photo and no vector for it still has work owed. */
  private owesImageVector(item: StoredItemWithVectors): boolean {
    if (item.imageEmbedding) return false;

    return (item.cloudinaryUrls ?? []).some(isFetchableImageUrl);
  }

  private async embedText(content: string, key: string): Promise<Float32Array> {
    const hit = await this.cache.get(key);

    if (hit) return hit;

    const [vector] = await this.text.embed([content]);

    await this.cache.set(key, vector);

    return vector;
  }

  /**
   * The first image that can actually be read.
   *
   * One vector per item rather than one per photo: the item is the thing being
   * searched for, and the report's first image is the one the reporter chose
   * to lead with. Ranking several photos per item is the re-identification
   * work in section 21.2, not this.
   */
  private async embedFirstImage(item: StoredItemWithVectors): Promise<Float32Array | undefined> {
    const urls = (item.cloudinaryUrls ?? []).filter(isFetchableImageUrl);

    if (urls.length === 0) return undefined;

    const spec = imageModel();

    for (const url of urls) {
      const bytes = await fetchImageBytes(url);

      if (!bytes) continue;

      // Keyed on the bytes rather than the URL they came from. A URL is only a
      // safe key while every upload produces a new one, which is true of the
      // current Cloudinary call and would stop being true the moment any
      // upload path set a deterministic `public_id` and overwrote. Hashing
      // what actually went into the model cannot go wrong that way. The fetch
      // is paid either way; what the cache saves is the inference.
      const key = contentKey(spec.id, spec.revision, bytes);
      const hit = await this.cache.get(key);

      if (hit) return hit;

      try {
        const [vector] = await this.images.embedImage([bytes]);

        await this.cache.set(key, vector);

        return vector;
      } catch (error) {
        // A photo the decoder cannot read is not a reason to leave the item
        // without its text vector.
        log.warn('Could not embed an item image', { itemId: item.id, error });
      }
    }

    return undefined;
  }
}

export const embeddingService = new EmbeddingService();
