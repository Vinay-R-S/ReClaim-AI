/**
 * The vector index, as the rest of the application sees it.
 *
 * ADR 0003 picked Firestore native vector search and put it behind this port
 * for one reason: the store is the piece most likely to change. At ten
 * thousand items and 384 dimensions the whole index is about fifteen
 * megabytes, which does not justify a second datastore; at a hundred thousand
 * it might, and then the migration is one new adapter plus a backfill rather
 * than a change to the matching pipeline.
 *
 * Nothing above this port knows what is behind it, and nothing above it knows
 * that today the index and the item collection are the same documents.
 */

export type VectorField = 'embedding' | 'imageEmbedding';

/**
 * Pre-filters applied in the same query as the nearest-neighbour search.
 *
 * Equality only, and deliberately so: Firestore serves a vector query from a
 * composite index whose non-vector fields are equality-filtered, and a range
 * filter would need its own index and still narrow after the fact. Time and
 * distance are ranges, so they are applied to the result rather than the
 * query, and the caller over-fetches to leave room for what they remove.
 *
 * Both are required rather than optional. A vector query is served by exactly
 * the composite index whose equality prefix it matches, so a caller omitting
 * one would build a query no deployed index covers, and the failure is a
 * FAILED_PRECONDITION that this layer turns into an empty result. Optional
 * fields would make that a typo rather than a compile error.
 */
export interface VectorFilters {
  type: string;
  status: string;
}

export interface VectorHit {
  id: string;
  /** Cosine distance, so 0 is identical and 2 is opposite. */
  distance: number;
  /** The stored document, so a hit does not cost a second read. */
  data: Record<string, unknown>;
}

export interface VectorSearchOptions {
  field?: VectorField;
  /**
   * Reject anything past this cosine distance before it is returned.
   *
   * A nearest-neighbour query always answers with the k nearest, however far
   * away they are, so without a bound an empty corpus of related items still
   * produces k confident-looking candidates.
   */
  maxDistance?: number;
}

export interface VectorIndex {
  readonly id: string;
  upsert(id: string, vector: Float32Array, payload?: Record<string, unknown>): Promise<void>;
  deleteById(id: string): Promise<void>;
  search(
    vector: Float32Array,
    filters: VectorFilters,
    k: number,
    options?: VectorSearchOptions,
  ): Promise<VectorHit[]>;
}

/**
 * Firestore's COSINE distance back to a cosine similarity.
 *
 * The distance is `1 - cosine similarity`, so this is a subtraction and not a
 * rescale. An earlier version divided by two, which maps the [0,2] distance
 * range onto [0,1] and reads 0.6 for a pair whose actual cosine is 0.2: a
 * number that looks like a similarity, is on a different scale, and made every
 * threshold reasoned about in it wrong.
 *
 * Clamped at zero because a genuinely opposed pair is not usefully negative
 * here; nothing downstream distinguishes "unrelated" from "opposite".
 */
export function similarityFromDistance(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance));
}

/**
 * Cosine similarity between two vectors held in memory.
 *
 * The encoders in `platform/embeddings` L2-normalise their output, so for
 * their vectors this is a dot product and the division is by one. It divides
 * anyway: the caller here is a tool that reads whatever is stored on an item
 * document, which may have been written by an older encoder or a backfill, and
 * a similarity that is silently a dot product of unnormalised vectors is
 * unbounded and reads as a confident number.
 *
 * Returns null rather than a number when the two cannot be compared at all: a
 * length mismatch means two different models, and comparing across them
 * produces a value with no meaning.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number | null {
  if (a.length === 0 || a.length !== b.length) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) return null;

  return dot / Math.sqrt(normA * normB);
}
