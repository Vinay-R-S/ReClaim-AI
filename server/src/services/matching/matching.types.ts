/**
 * Types shared by the matching pipeline stages.
 */

import { Coordinates, Item } from '../../types/index.js';

/**
 * The subject of a matching run: either a stored item or a manual search.
 *
 * Manual search carries `imageBase64` because the image was never uploaded, so
 * the visual scorer accepts both addressing modes.
 */
export interface MatchSubject {
  id?: string;
  name: string;
  description: string;
  tags?: string[];
  color?: string;
  category?: string;
  location?: string;
  coordinates?: Coordinates;
  date: Date;
  cloudinaryUrls?: string[];
  imageUrl?: string;
  imageBase64?: string;
}

/** One image, addressed either by URL or by inline data. */
export type ImageRef = { kind: 'url'; url: string } | { kind: 'base64'; data: string };

/**
 * A scored component.
 *
 * `applicable` is the whole point: a component that could not run must leave
 * the denominator as well as the numerator, otherwise every score is silently
 * depressed by that component's full weight.
 */
export interface ScoreComponent {
  score: number;
  weight: number;
  applicable: boolean;
}

export interface ScoreBreakdown {
  semantic: ScoreComponent;
  color: ScoreComponent;
  location: ScoreComponent;
  time: ScoreComponent;
  image: ScoreComponent;
}

export interface ScoredCandidate {
  item: Item;
  /** Normalised 0-100 over the components that actually ran. */
  score: number;
  /** Raw weighted points, before normalisation. */
  rawScore: number;
  /** Sum of the weights that applied. */
  applicableWeight: number;
  breakdown: ScoreBreakdown;
  /** Cheap lexical overlap, 0-1. Used for ordering, never as a gate. */
  preScore: number;
}

export interface MatchingRunOptions {
  /**
   * How many candidates reach the semantic and visual scorers. The rest keep
   * their lexical pre-score and are reported as evaluated but not scored.
   */
  maxScoredCandidates?: number;
  /** Concurrent third-party calls. */
  concurrency?: number;
}

export interface SemanticScorer {
  /** 0-100 similarity, or null when the provider could not answer. */
  score(a: MatchSubject, b: Item): Promise<number | null>;
}

export interface VisualScorer {
  isConfigured(): boolean;
  /** 0-100 similarity, or null when no comparison was possible. */
  score(a: ImageRef[], b: ImageRef[]): Promise<number | null>;
}
