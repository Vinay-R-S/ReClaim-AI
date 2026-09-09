/**
 * The embedding platform, as seen by the rest of the application.
 *
 * Callers depend on the ports declared in `platform/ai/ports/embedding.port.ts`
 * and on the two singletons here. Nothing outside this directory imports ONNX,
 * a tokenizer or a model identifier, which is what lets the runtime move to a
 * sidecar later without a caller changing (ADR 0004).
 */

export { OnnxTextEmbedder, textEmbedder } from './text.embedder.js';
export { OnnxImageEmbedder, imageEmbedder } from './image.embedder.js';
export { EmbeddingCache, embeddingCache, contentKey } from './embedding.cache.js';
export { fetchImageBytes, isFetchableImageUrl } from './image.source.js';
export { imageModel, textModel } from './models.js';
export type { EmbeddingModelSpec, ModelPrecision } from './models.js';
export { configureRuntime, resetRuntime } from './runtime.js';
export type {
  Detection,
  EmbeddingProvider,
  ImageEmbedder,
  VisionProvider,
} from '../ai/ports/embedding.port.js';
