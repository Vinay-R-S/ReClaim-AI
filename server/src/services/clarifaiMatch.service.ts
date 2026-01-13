/**
 * Clarifai Image Matching Service
 * Uses Clarifai Visual Search API to compare image similarity
 */

import fetch from 'node-fetch';

const CLARIFAI_API_KEY = process.env.CLARIFAI_API_KEY;
const CLARIFAI_PAT = process.env.CLARIFAI_PAT || CLARIFAI_API_KEY; // Personal Access Token
const CLARIFAI_USER_ID = process.env.CLARIFAI_USER_ID || 'clarifai';
const CLARIFAI_APP_ID = process.env.CLARIFAI_APP_ID || 'main';
const CLARIFAI_MODEL_ID = process.env.CLARIFAI_MODEL_ID || 'general-image-recognition';



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
export async function compareImages(
    imageUrl1: string,
    imageUrl2: string
): Promise<number> {
    // Validate inputs
    if (!imageUrl1 || !imageUrl2) {
        console.warn('[CLARIFAI] Missing image URL(s), returning 0 score');
        return 0;
    }

    // Check if API key is configured
    if (!CLARIFAI_PAT) {
        console.error('[CLARIFAI] API key not configured (CLARIFAI_API_KEY or CLARIFAI_PAT missing in .env)');
        return 0;
    }

    try {
        console.log(`[CLARIFAI] Comparing images: ${imageUrl1.substring(0, 50)}... vs ${imageUrl2.substring(0, 50)}...`);

        // Use Clarifai's visual similarity workflow
        // We'll use a simpler approach: get concepts from both images and compare them
        const concepts1 = await getImageConcepts(imageUrl1);
        const concepts2 = await getImageConcepts(imageUrl2);

        if (!concepts1 || !concepts2) {
            console.warn('[CLARIFAI] Failed to get concepts from one or both images');
            return 0;
        }

        // Calculate similarity based on concept overlap and confidence scores
        const similarity = calculateConceptSimilarity(concepts1, concepts2);

        console.log(`[CLARIFAI] Similarity score: ${similarity}%`);
        return similarity;

    } catch (error) {
        console.error('[CLARIFAI] Error comparing images:', error);
        return 0; // Return 0 on error to prevent matching
    }
}

/**
 * Compare multiple images from two items and return the best match score
 * Cross-compares all images from item1 with all images from item2
 * @param imageUrls1 - Array of image URLs from first item
 * @param imageUrls2 - Array of image URLs from second item
 * @returns Best similarity score from 0-100 across all pairs
 */
export async function compareMultipleImages(
    imageUrls1: string[],
    imageUrls2: string[]
): Promise<number> {
    // Filter out empty/null URLs
    const urls1 = imageUrls1.filter(url => url && url.trim());
    const urls2 = imageUrls2.filter(url => url && url.trim());

    // If either set is empty, return 0
    if (urls1.length === 0 || urls2.length === 0) {
        console.warn('[CLARIFAI] One or both image arrays are empty, returning 0 score');
        return 0;
    }

    // If only one image each, use the simple comparison
    if (urls1.length === 1 && urls2.length === 1) {
        return compareImages(urls1[0], urls2[0]);
    }

    console.log(`[CLARIFAI] Cross-comparing ${urls1.length} images with ${urls2.length} images`);

    try {
        // Build all comparison pairs
        const comparisonPairs: Array<{ url1: string; url2: string }> = [];
        for (const url1 of urls1) {
            for (const url2 of urls2) {
                comparisonPairs.push({ url1, url2 });
            }
        }

        // Run comparisons (limit to first 9 pairs to avoid API rate limits)
        const pairsToCompare = comparisonPairs.slice(0, 9);
        const comparisonPromises = pairsToCompare.map(pair =>
            compareImages(pair.url1, pair.url2)
        );

        const scores = await Promise.all(comparisonPromises);
        const maxScore = Math.max(...scores, 0);

        console.log(`[CLARIFAI] Best match score across ${pairsToCompare.length} pairs: ${maxScore}%`);
        return maxScore;

    } catch (error) {
        console.error('[CLARIFAI] Error in multi-image comparison:', error);
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
                    'Authorization': `Key ${CLARIFAI_PAT}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    inputs: [
                        {
                            data: {
                                image: {
                                    url: imageUrl
                                }
                            }
                        }
                    ]
                }),
                // @ts-ignore - node-fetch types
                timeout: 10000, // 10 second timeout
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[CLARIFAI] API error: ${response.status} - ${errorText}`);
            return null;
        }

        const data = await response.json() as ClarifaiResponse;

        if (data.status.code !== 10000) {
            console.error(`[CLARIFAI] API returned error: ${data.status.description}`);
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

        console.log(`[CLARIFAI] Found ${concepts.size} concepts for image`);
        return concepts;

    } catch (error) {
        console.error('[CLARIFAI] Error getting image concepts:', error);
        return null;
    }
}

/**
 * Calculate similarity between two sets of concepts
 * Uses weighted Jaccard similarity with confidence scores
 */
function calculateConceptSimilarity(
    concepts1: Map<string, number>,
    concepts2: Map<string, number>
): number {
    if (concepts1.size === 0 || concepts2.size === 0) {
        return 0;
    }

    // Find common concepts and calculate weighted intersection
    let weightedIntersection = 0;
    let weightedUnion = 0;

    // Get all unique concept names
    const allConcepts = new Set([...concepts1.keys(), ...concepts2.keys()]);

    for (const concept of allConcepts) {
        const score1 = concepts1.get(concept) || 0;
        const score2 = concepts2.get(concept) || 0;

        // Weighted intersection: minimum of the two scores
        weightedIntersection += Math.min(score1, score2);

        // Weighted union: maximum of the two scores
        weightedUnion += Math.max(score1, score2);
    }

    if (weightedUnion === 0) {
        return 0;
    }

    // Calculate Jaccard similarity and convert to percentage
    const similarity = (weightedIntersection / weightedUnion) * 100;

    // Round to whole number
    return Math.round(similarity);
}

/**
 * Check if Clarifai service is configured
 */
export function isClarifaiConfigured(): boolean {
    return !!CLARIFAI_PAT;
}
