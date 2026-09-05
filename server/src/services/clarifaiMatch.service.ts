/**
 * Clarifai Image Matching Service
 * Uses Clarifai Visual Search API to compare image similarity
 */

import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';

const log = createLogger('clarifaiMatch');

const CLARIFAI_PAT = env.clarifai.pat; // Personal Access Token
const CLARIFAI_USER_ID = env.clarifai.userId;
const CLARIFAI_APP_ID = env.clarifai.appId;
const CLARIFAI_MODEL_ID = env.clarifai.modelId;

/** Hard ceiling on one Clarifai call. */
const CLARIFAI_TIMEOUT_MS = 10000;

/**
 * An image Clarifai can accept: a hosted URL, or inline data for the manual
 * search path, where the upload never happened.
 */
export type ClarifaiImage = { url: string } | { base64: string };

interface ClarifaiResponse {
  status: {
    code: number;
    description: string;
  };
  outputs?: Array<{
    data?: {
      concepts?: Array<{
        name: string;
        value: number;
      }>;
    };
  }>;
}

/**
 * Get visual concepts from an image using Clarifai.
 *
 * The old `timeout` property was a node-fetch option that native fetch ignores,
 * so a hung Clarifai request had nothing stopping it. This aborts for real.
 */
export async function fetchImageConcepts(
  image: ClarifaiImage,
): Promise<Map<string, number> | null> {
  if (!CLARIFAI_PAT) {
    log.error('[CLARIFAI] API key not configured (CLARIFAI_API_KEY or CLARIFAI_PAT missing)');
    return null;
  }

  try {
    const response = await fetch(
      `https://api.clarifai.com/v2/users/${CLARIFAI_USER_ID}/apps/${CLARIFAI_APP_ID}/models/${CLARIFAI_MODEL_ID}/outputs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${CLARIFAI_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: [{ data: { image } }] }),
        signal: AbortSignal.timeout(CLARIFAI_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`[CLARIFAI] API error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = (await response.json()) as ClarifaiResponse;

    if (data.status.code !== 10000) {
      log.error('API returned an error', { status: data.status.code });
      return null;
    }

    // Extract concepts and their confidence scores
    const concepts = new Map<string, number>();
    const output = data.outputs?.[0];

    if (output?.data?.concepts) {
      for (const concept of output.data.concepts) {
        concepts.set(concept.name.toLowerCase(), concept.value);
      }
    }

    log.debug(`[CLARIFAI] Found ${concepts.size} concepts for image`);
    return concepts;
  } catch (error) {
    log.error('Error getting image concepts:', error);
    return null;
  }
}

/**
 * Calculate similarity between two sets of concepts
 * Enhanced algorithm with semantic boosting and better weight distribution
 */
export function conceptSimilarity(
  concepts1: Map<string, number>,
  concepts2: Map<string, number>,
): number {
  if (concepts1.size === 0 || concepts2.size === 0) {
    return 0;
  }

  // Convert to sorted arrays (highest confidence first)
  const concepts1Array = Array.from(concepts1.entries()).sort((a, b) => b[1] - a[1]);
  const concepts2Array = Array.from(concepts2.entries()).sort((a, b) => b[1] - a[1]);

  // Focus on top concepts (first 20) as they're most reliable
  const topConcepts1 = new Map(concepts1Array.slice(0, 20));
  const topConcepts2 = new Map(concepts2Array.slice(0, 20));

  // Get all unique concept names from top concepts
  const allConcepts = new Set([...topConcepts1.keys(), ...topConcepts2.keys()]);

  let weightedIntersection = 0;
  let weightedUnion = 0;
  let exactMatches = 0;
  let strongMatches = 0; // Matches where both scores > 0.7

  for (const concept of allConcepts) {
    const score1 = topConcepts1.get(concept) || 0;
    const score2 = topConcepts2.get(concept) || 0;

    // Weighted intersection with exponential boost for strong matches
    if (score1 > 0 && score2 > 0) {
      // Apply exponential weight to reward strong matches
      const avgScore = (score1 + score2) / 2;
      const matchWeight = Math.pow(avgScore, 1.5); // Exponential boost

      weightedIntersection += Math.min(score1, score2) * matchWeight;
      exactMatches++;

      // Count strong matches (both > 0.7 confidence)
      if (score1 > 0.7 && score2 > 0.7) {
        strongMatches++;
      }
    }

    // Weighted union with square root to reduce penalty
    weightedUnion += Math.max(score1, score2);
  }

  if (weightedUnion === 0) {
    return 0;
  }

  // Base Jaccard similarity
  let similarity = (weightedIntersection / weightedUnion) * 100;

  // BOOST 1: Reward exact matches
  const matchRatio = exactMatches / allConcepts.size;
  if (matchRatio > 0.3) {
    // If >30% of concepts match
    similarity *= 1 + matchRatio * 0.3; // Up to 30% boost
  }

  // BOOST 2: Reward strong matches
  if (strongMatches > 3) {
    similarity *= 1 + strongMatches * 0.05; // 5% boost per strong match
  }

  // BOOST 3: Semantic category matching
  // Group similar concepts (e.g., "bag", "backpack", "handbag")
  const categories = detectSemanticCategories(topConcepts1, topConcepts2);
  if (categories.length > 0) {
    similarity *= 1 + categories.length * 0.1; // 10% boost per category match
  }

  // Cap at 100 and round
  return Math.min(100, Math.round(similarity));
}

/**
 * Detect semantic categories that match between two concept sets
 * E.g., both have bag-related concepts, phone-related concepts, etc.
 */
function detectSemanticCategories(
  concepts1: Map<string, number>,
  concepts2: Map<string, number>,
): string[] {
  const categories: { [key: string]: string[] } = {
    bag: ['bag', 'backpack', 'purse', 'handbag', 'luggage', 'suitcase', 'rucksack'],
    phone: ['phone', 'mobile', 'smartphone', 'iphone', 'android', 'cellphone'],
    electronics: ['laptop', 'computer', 'tablet', 'ipad', 'device', 'gadget'],
    clothing: ['jacket', 'coat', 'shirt', 'pants', 'dress', 'clothing', 'apparel'],
    accessory: ['watch', 'jewelry', 'glasses', 'sunglasses', 'accessory', 'bracelet'],
    key: ['key', 'keychain', 'keys', 'fob'],
    wallet: ['wallet', 'purse', 'billfold'],
    bottle: ['bottle', 'flask', 'container', 'tumbler'],
    card: ['card', 'id', 'license', 'badge'],
  };

  const matchedCategories: string[] = [];

  for (const [category, keywords] of Object.entries(categories)) {
    const has1 = Array.from(concepts1.keys()).some((c) => keywords.some((k) => c.includes(k)));
    const has2 = Array.from(concepts2.keys()).some((c) => keywords.some((k) => c.includes(k)));

    if (has1 && has2) {
      matchedCategories.push(category);
    }
  }

  return matchedCategories;
}

/**
 * Check if Clarifai service is configured
 */
export function isClarifaiConfigured(): boolean {
  return !!CLARIFAI_PAT;
}
