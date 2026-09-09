/**
 * Which models produce the vectors, and what shape they produce.
 *
 * Everything that distinguishes one encoder from another is data here: the
 * repository it comes from, the revision it is pinned to, how many dimensions
 * it emits and what precision it runs at. Swapping an encoder is an entry in
 * this file plus a backfill, because a vector from one model is not comparable
 * to a vector from another.
 *
 * The dimension is recorded rather than discovered so that a model swap that
 * changes it is caught on the first call instead of producing a corpus of
 * vectors that silently cannot be compared with each other.
 */

import { env } from '../../config/env.js';

/** int8 dynamic, which is what ADR 0004 asks for. */
export type ModelPrecision = 'q8' | 'fp32';

export interface EmbeddingModelSpec {
  /** The repository the weights come from. */
  id: string;
  /**
   * A branch, tag or commit. `main` follows the repository, which is fine for
   * development and wrong for production: pin a commit so a model cannot
   * change under a corpus of vectors that were produced by the old one.
   */
  revision: string;
  dimensions: number;
  precision: ModelPrecision;
}

/**
 * The text encoder.
 *
 * `bge-small-en-v1.5` rather than `all-MiniLM-L6-v2`: both emit 384
 * dimensions, so they are interchangeable without a schema change, and the
 * former is meaningfully stronger on retrieval for about ten megabytes more.
 * Lost-and-found text is short, so the extra layers cost little wall clock.
 */
export function textModel(): EmbeddingModelSpec {
  return {
    id: env.embeddings.textModel,
    revision: env.embeddings.textModelRevision,
    dimensions: env.embeddings.textDimensions,
    precision: 'q8',
  };
}

/**
 * The image encoder: the vision tower of CLIP ViT-B/32, which emits 512
 * dimensions into the same space its text tower uses.
 *
 * This is the piece that turns the CCTV feature from "some backpack was on
 * camera" into "this backpack was on camera" (PLAN.md section 21.2), so it is
 * built here even though nothing consumes it until a later phase.
 */
export function imageModel(): EmbeddingModelSpec {
  return {
    id: env.embeddings.imageModel,
    revision: env.embeddings.imageModelRevision,
    dimensions: env.embeddings.imageDimensions,
    precision: 'q8',
  };
}
