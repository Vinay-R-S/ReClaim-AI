/**
 * Embedding ports.
 *
 * Declared here in phase 21 and implemented in phase 22, so that the retrieval
 * work has an interface to build against and the router has one shape to
 * route. Nothing implements them yet, which the registry says out loud rather
 * than pretending otherwise.
 */

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface ImageEmbedder {
  readonly id: string;
  readonly dimensions: number;
  embedImage(images: Buffer[]): Promise<Float32Array[]>;
}

export interface Detection {
  label: string;
  confidence: number;
  box?: { x: number; y: number; width: number; height: number };
}

export interface VisionProvider {
  readonly id: string;
  detect(image: Buffer): Promise<Detection[]>;
}
