/**
 * Manual match search.
 *
 * The second entry point onto `MatchingService`. It scores an ad-hoc search
 * payload rather than a stored item, and has no side effects: it returns a
 * ranked list and writes nothing.
 */

import { Coordinates, MatchResult } from '../types/index.js';
import { MatchingService } from './matching/matching.pipeline.js';
import { MatchSubject, ScoredCandidate } from './matching/matching.types.js';

export interface MatchSearchInput {
  name: string;
  description: string;
  tags?: string[];
  color?: string;
  category?: string;
  location?: string;
  coordinates?: Coordinates;
  date: Date;
  /** Manual search never uploads, so the image arrives inline. */
  imageBase64?: string;
  cloudinaryUrls?: string[];
}

/**
 * Manual search is a user-facing request, so it scores fewer candidates than
 * the create path: the caller is waiting on the response.
 */
const SEARCH_MAX_SCORED_CANDIDATES = 15;

function toMatchResult(candidate: ScoredCandidate): MatchResult {
  const { breakdown } = candidate;

  return {
    itemId: candidate.item.id,
    item: candidate.item,
    score: candidate.score,
    breakdown: {
      tagScore: breakdown.semantic.score, // Mapped for frontend compatibility
      descriptionScore: 0,
      colorScore: breakdown.color.score,
      locationScore: breakdown.location.score,
      timeScore: breakdown.time.score,
      imageScore: breakdown.image.score,
    },
  };
}

function toSubject(input: MatchSearchInput): MatchSubject {
  return {
    name: input.name,
    description: input.description,
    tags: input.tags,
    color: input.color,
    category: input.category,
    location: input.location,
    coordinates: input.coordinates,
    date: input.date,
    cloudinaryUrls: input.cloudinaryUrls,
    imageBase64: input.imageBase64,
  };
}

async function search(
  input: MatchSearchInput,
  subjectType: 'Lost' | 'Found',
): Promise<MatchResult[]> {
  const pipeline = new MatchingService();

  const { matches } = await pipeline.run(toSubject(input), subjectType, {
    maxScoredCandidates: SEARCH_MAX_SCORED_CANDIDATES,
  });

  return matches.map(toMatchResult);
}

/**
 * Find found items that could be this lost item.
 */
export function findMatchesForLostItem(lostItem: MatchSearchInput): Promise<MatchResult[]> {
  return search(lostItem, 'Lost');
}

/**
 * Find lost items that could be this found item.
 */
export function findMatchesForFoundItem(foundItem: MatchSearchInput): Promise<MatchResult[]> {
  return search(foundItem, 'Found');
}
