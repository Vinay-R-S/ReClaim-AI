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
 * Compare two images using Clarifai API and return similarity score
 * @param imageUrl1 - First image URL
 * @param imageUrl2 - Second image URL  
 * @returns Similarity score from 0-100
 */
export async function compareImages(imageUrl1: string, imageUrl2: string): Promise<number> {
  // Validate inputs
  if (!imageUrl1 || !imageUrl2) {
    log.warn('Missing image URL(s), returning 0 score');
    return 0;
  }

  // Check if API key is configured
  if (!CLARIFAI_PAT) {
    log.error(
      '[CLARIFAI] API key not configured (CLARIFAI_API_KEY or CLARIFAI_PAT missing in .env)',
    );
    return 0;
  }

  try {
    log.info(
      `[CLARIFAI] Comparing images: ${imageUrl1.substring(0, 50)}... vs ${imageUrl2.substring(0, 50)}...`,
    );

    // Use Clarifai's visual similarity workflow
    // We'll use a simpler approach: get concepts from both images and compare them
    const concepts1 = await getImageConcepts(imageUrl1);
    const concepts2 = await getImageConcepts(imageUrl2);

    if (!concepts1 || !concepts2) {
      log.warn('Failed to get concepts from one or both images');
      return 0;
    }

    // Calculate similarity based on concept overlap and confidence scores
    const similarity = calculateConceptSimilarity(concepts1, concepts2);

    log.info(`[CLARIFAI] Similarity score: ${similarity}%`);
    return similarity;
  } catch (error) {
    log.error('Error comparing images:', error);
    return 0; // Return 0 on error to prevent matching
  }
}

/**
 * Compare multiple images from two items and return the best match score
 * Cross-compares all images from item1 with all images from item2
 * Uses both best match and average match for scoring
 * @param imageUrls1 - Array of image URLs from first item
 * @param imageUrls2 - Array of image URLs from second item
 * @returns Similarity score from 0-100
 */
export async function compareMultipleImages(
  imageUrls1: string[],
  imageUrls2: string[],
): Promise<number> {
  // Filter out empty/null URLs
  const urls1 = imageUrls1.filter((url) => url && url.trim());
  const urls2 = imageUrls2.filter((url) => url && url.trim());

  // If either set is empty, return 0
  if (urls1.length === 0 || urls2.length === 0) {
    log.warn('One or both image arrays are empty, returning 0 score');
    return 0;
  }

  // If only one image each, use the simple comparison
  if (urls1.length === 1 && urls2.length === 1) {
    log.info('Single image comparison');
    return compareImages(urls1[0], urls2[0]);
  }

  log.info(`[CLARIFAI] Cross-comparing ${urls1.length} images with ${urls2.length} images`);

  try {
    // Build all comparison pairs
    const comparisonPairs: Array<{ url1: string; url2: string }> = [];
    for (const url1 of urls1) {
      for (const url2 of urls2) {
        comparisonPairs.push({ url1, url2 });
      }
    }

    // For better results:
    // - If <=9 pairs: compare all
    // - If >9 pairs: compare first 9 (to avoid rate limits)
    const pairsToCompare = comparisonPairs.slice(0, Math.min(comparisonPairs.length, 9));

    log.info(`[CLARIFAI] Comparing ${pairsToCompare.length} image pairs...`);

    const comparisonPromises = pairsToCompare.map((pair) => compareImages(pair.url1, pair.url2));

    const scores = await Promise.all(comparisonPromises);

    // Calculate both best match and average
    const maxScore = Math.max(...scores, 0);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    // Use weighted combination: 70% best match + 30% average
    // This prevents one really good match from dominating when other images don't match
    const finalScore = Math.round(maxScore * 0.7 + avgScore * 0.3);

    log.info(
      `[CLARIFAI] Image scores - Best: ${maxScore}%, Avg: ${avgScore.toFixed(1)}%, Final: ${finalScore}%`,
    );
    return finalScore;
  } catch (error) {
    log.error('Error in multi-image comparison:', error);
    return 0;
  }
}

/**
 * Get visual concepts from an image using Clarifai
 */
async function getImageConcepts(imageUrl: string): Promise<Map<string, number> | null> {
  try {
    const response = await fetch(
      `https://api.clarifai.com/v2/users/${CLARIFAI_USER_ID}/apps/${CLARIFAI_APP_ID}/models/${CLARIFAI_MODEL_ID}/outputs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${CLARIFAI_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: [
            {
              data: {
                image: {
                  url: imageUrl,
                },
              },
            },
          ],
        }),
        // @ts-ignore - node-fetch types
        timeout: 10000, // 10 second timeout
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

    log.info(`[CLARIFAI] Found ${concepts.size} concepts for image`);
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
function calculateConceptSimilarity(
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
