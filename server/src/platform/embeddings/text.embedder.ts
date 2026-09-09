/**
 * The text encoder, implementing the `EmbeddingProvider` port declared in
 * phase 21.
 *
 * Mean pooling over the token outputs and L2 normalisation, which is what this
 * family of models is trained for and what makes a dot product a cosine
 * similarity. Normalising here rather than at comparison time means every
 * consumer gets it right by default, including the Firestore nearest-neighbour
 * query in the next phase, which cannot normalise for us.
 */

import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { createLogger } from '../../utils/logger.js';
import { configureRuntime, loadOnce, sessionOptions } from './runtime.js';
import { textModel, type EmbeddingModelSpec } from './models.js';
import type { EmbeddingProvider } from '../ai/ports/embedding.port.js';

const log = createLogger('embeddings:text');

/**
 * Longer input is truncated by the tokenizer rather than rejected.
 *
 * A description that runs past the model's window still describes the item in
 * its first hundred tokens, and refusing to embed it would leave the item
 * unmatchable. Truncation is the tokenizer's job; this only says it is allowed.
 */
const TOKENIZER_OPTIONS = { padding: true, truncation: true } as const;

export class OnnxTextEmbedder implements EmbeddingProvider {
  private readonly spec: EmbeddingModelSpec;

  constructor(spec: EmbeddingModelSpec = textModel()) {
    this.spec = spec;
  }

  get id(): string {
    return this.spec.id;
  }

  get dimensions(): number {
    return this.spec.dimensions;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const extract = await this.pipeline();
    const output = await extract(texts, {
      ...TOKENIZER_OPTIONS,
      pooling: 'mean',
      normalize: true,
    });

    const [rows, dimensions] = output.dims;

    if (dimensions !== this.spec.dimensions) {
      // Caught on the first call rather than after a corpus of vectors that
      // cannot be compared with the ones already stored.
      throw new Error(
        `${this.spec.id} emitted ${dimensions} dimensions, not the ${this.spec.dimensions} this deployment stores`,
      );
    }

    const data = output.data as Float32Array;

    return Array.from({ length: rows }, (_unused, row) =>
      // `slice`, not `subarray`: a view would keep the whole batch tensor
      // alive for as long as any one of its vectors is referenced.
      data.slice(row * dimensions, (row + 1) * dimensions),
    );
  }

  private pipeline(): Promise<FeatureExtractionPipeline> {
    configureRuntime();

    return loadOnce(`text:${this.spec.id}@${this.spec.revision}`, async () => {
      log.info('Loading the text encoder', { model: this.spec.id, precision: this.spec.precision });

      return pipeline('feature-extraction', this.spec.id, {
        revision: this.spec.revision,
        dtype: this.spec.precision,
        session_options: sessionOptions(),
      });
    });
  }
}

export const textEmbedder = new OnnxTextEmbedder();
