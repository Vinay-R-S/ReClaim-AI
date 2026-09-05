/**
 * Visual scoring stage.
 *
 * Clarifai returns concepts per image, so concepts are fetched once per image
 * and reused for every candidate in the run. The previous code compared image
 * pairs, which made the number of API calls grow with candidates times images
 * even though the subject's own images never change during a run.
 */

import {
  ClarifaiImage,
  fetchImageConcepts,
  conceptSimilarity,
  isClarifaiConfigured,
} from '../clarifaiMatch.service.js';
import { createLogger } from '../../utils/logger.js';
import { createLimiter } from '../../utils/async.js';
import { ImageRef, VisualScorer } from './matching.types.js';

const log = createLogger('matching:visual');

/** Cap on images considered per side, so one item with many photos cannot dominate a run. */
const MAX_IMAGES_PER_SIDE = 3;

/** Concurrent concept fetches. */
const CONCEPT_CONCURRENCY = 3;

type Concepts = Map<string, number>;

function cacheKey(image: ImageRef): string {
  return image.kind === 'url'
    ? `url:${image.url}`
    : `b64:${image.data.length}:${image.data.slice(0, 64)}`;
}

function toClarifaiImage(image: ImageRef): ClarifaiImage {
  return image.kind === 'url' ? { url: image.url } : { base64: image.data };
}

/**
 * Clarifai-backed scorer with a per-instance concept cache.
 *
 * One instance is created per matching run, so the cache lives exactly as long
 * as the work that benefits from it.
 */
export class ClarifaiVisualScorer implements VisualScorer {
  /**
   * Keyed on image, holding the in-flight promise rather than its result.
   *
   * Caching the resolved value only deduplicates after the first fetch
   * returns, so the opening wave of concurrent candidates all missed on the
   * subject's own images and fetched them once each.
   */
  private readonly cache = new Map<string, Promise<Concepts | null>>();

  private readonly limiter = createLimiter(CONCEPT_CONCURRENCY);

  isConfigured(): boolean {
    return isClarifaiConfigured();
  }

  private conceptsFor(images: ImageRef[]): Promise<Concepts[]> {
    const wanted = images.slice(0, MAX_IMAGES_PER_SIDE);

    // The promise goes into the cache before anything is awaited, so a
    // concurrent candidate finds the in-flight fetch instead of starting its
    // own. The limiter still caps how many run at once.
    for (const image of wanted) {
      const key = cacheKey(image);

      if (!this.cache.has(key)) {
        this.cache.set(
          key,
          this.limiter(() => fetchImageConcepts(toClarifaiImage(image))),
        );
      }
    }

    const pending = wanted.map(
      (image) => this.cache.get(cacheKey(image)) as Promise<Concepts | null>,
    );

    return Promise.all(pending).then((results) =>
      results.filter((concepts): concepts is Concepts => Boolean(concepts && concepts.size > 0)),
    );
  }

  /**
   * Cross-compare both sides and blend the best pair with the average, so one
   * lucky pair cannot carry an otherwise unrelated set of photos.
   */
  async score(a: ImageRef[], b: ImageRef[]): Promise<number | null> {
    if (!this.isConfigured()) return null;
    if (a.length === 0 || b.length === 0) return null;

    const [conceptsA, conceptsB] = await Promise.all([this.conceptsFor(a), this.conceptsFor(b)]);

    if (conceptsA.length === 0 || conceptsB.length === 0) {
      log.debug('No concepts available on one side, skipping visual score');
      return null;
    }

    const scores: number[] = [];

    for (const left of conceptsA) {
      for (const right of conceptsB) {
        scores.push(conceptSimilarity(left, right));
      }
    }

    if (scores.length === 0) return null;

    const best = Math.max(...scores);
    const average = scores.reduce((total, value) => total + value, 0) / scores.length;

    return Math.round(best * 0.7 + average * 0.3);
  }
}
