/**
 * The image encoder, implementing the `ImageEmbedder` port declared in
 * phase 21.
 *
 * The vision tower of CLIP, which turns a photo into a vector in the same
 * space its text tower uses. That is the piece the CCTV rebuild needs: it is
 * what separates "some object of this category was on camera" from "this
 * object was on camera" (PLAN.md section 21.2).
 *
 * The processor is not an implementation detail worth hand-rolling. Resize to
 * the model's edge, centre crop, rescale, then normalise per channel with the
 * model's own mean and standard deviation. Every one of those constants comes
 * from the model repository, and getting one wrong produces vectors that look
 * perfectly reasonable and rank nothing correctly.
 */

import {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
  type Processor,
} from '@huggingface/transformers';
import { createLogger } from '../../utils/logger.js';
import { configureRuntime, loadOnce, sessionOptions } from './runtime.js';
import { imageModel, type EmbeddingModelSpec } from './models.js';
import type { ImageEmbedder } from '../ai/ports/embedding.port.js';

const log = createLogger('embeddings:image');

interface VisionTower {
  processor: Processor;
  model: CLIPVisionModelWithProjection;
}

/** L2, so a dot product against another vector is a cosine similarity. */
function normalize(vector: Float32Array): Float32Array {
  let sum = 0;

  for (let index = 0; index < vector.length; index += 1) sum += vector[index] * vector[index];

  const magnitude = Math.sqrt(sum);

  if (magnitude === 0) return vector;

  const unit = new Float32Array(vector.length);

  for (let index = 0; index < vector.length; index += 1) unit[index] = vector[index] / magnitude;

  return unit;
}

export class OnnxImageEmbedder implements ImageEmbedder {
  private readonly spec: EmbeddingModelSpec;

  constructor(spec: EmbeddingModelSpec = imageModel()) {
    this.spec = spec;
  }

  get id(): string {
    return this.spec.id;
  }

  get dimensions(): number {
    return this.spec.dimensions;
  }

  async embedImage(images: Buffer[]): Promise<Float32Array[]> {
    if (images.length === 0) return [];

    const { processor, model } = await this.tower();
    const decoded = await Promise.all(
      // A Blob rather than a path: these bytes arrive in a request or from
      // object storage and are never on this disk.
      images.map((image) => RawImage.fromBlob(new Blob([new Uint8Array(image)]))),
    );

    const inputs = await processor(decoded);
    const { image_embeds: embeds } = await model(inputs);

    const [rows, dimensions] = embeds.dims;

    if (dimensions !== this.spec.dimensions) {
      throw new Error(
        `${this.spec.id} emitted ${dimensions} dimensions, not the ${this.spec.dimensions} this deployment stores`,
      );
    }

    const data = embeds.data as Float32Array;

    // The projection head does not normalise, unlike the text pipeline, so it
    // is done here. Both vectors have to leave this directory unit length or
    // nothing downstream can treat a dot product as a similarity.
    return Array.from({ length: rows }, (_unused, row) =>
      normalize(data.slice(row * dimensions, (row + 1) * dimensions)),
    );
  }

  private tower(): Promise<VisionTower> {
    configureRuntime();

    return loadOnce(`image:${this.spec.id}@${this.spec.revision}`, async () => {
      log.info('Loading the image encoder', {
        model: this.spec.id,
        precision: this.spec.precision,
      });

      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(this.spec.id, { revision: this.spec.revision }),
        CLIPVisionModelWithProjection.from_pretrained(this.spec.id, {
          revision: this.spec.revision,
          dtype: this.spec.precision,
          session_options: sessionOptions(),
        }),
      ]);

      return { processor, model };
    });
  }
}

export const imageEmbedder = new OnnxImageEmbedder();
