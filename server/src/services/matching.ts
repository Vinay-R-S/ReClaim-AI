/**
 * Matching Service - Find potential matches between lost and found items
 */

import { collections } from '../utils/firebase-admin.js';
import { callLLM, parseJSONFromLLM } from '../utils/llm.js';
import { Item, MatchResult, SAFETY_LIMITS, Coordinates } from '../types/index.js';

// Weights for matching criteria (simplified to 50/50)
const MATCH_WEIGHTS = {
    text: 0.50,      // 50% - name, description, tags
    image: 0.50,     // 50% - AI vision comparison
};

// Location and time scoring removed per user requirements

/**
 * Calculate text similarity using keywords
 */
function calculateTextScore(
    itemName: string,
    itemDesc: string,
    itemTags: string[],
    searchName: string,
    searchDesc: string,
    searchTags: string[]
): number {
    // Combine all text for comparison
    const itemText = `${itemName} ${itemDesc} ${itemTags.join(' ')}`.toLowerCase();
    const searchText = `${searchName} ${searchDesc} ${searchTags.join(' ')}`.toLowerCase();

    // Extract keywords (remove common words)
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'my', 'i', 'it']);

    const itemWords = new Set(
        itemText.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w))
    );
    const searchWords = new Set(
        searchText.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w))
    );

    if (itemWords.size === 0 || searchWords.size === 0) {
        return 0.5;
    }

    // Calculate Jaccard similarity
    const intersection = [...itemWords].filter(w => searchWords.has(w)).length;
    const union = new Set([...itemWords, ...searchWords]).size;

    const jaccard = intersection / union;

    // Boost score for exact name match
    const nameBoost = itemName.toLowerCase().includes(searchName.toLowerCase()) ||
        searchName.toLowerCase().includes(itemName.toLowerCase())
        ? 0.2 : 0;

    return Math.min(1, jaccard + nameBoost);
}

/**
 * Calculate image similarity using AI vision
 */
async function calculateImageScore(
    itemImageUrl?: string,
    searchImageBase64?: string
): Promise<number> {
    if (!itemImageUrl || !searchImageBase64) {
        return 0.5; // Neutral if one image missing
    }

    try {
        const prompt = `Compare these two images and determine if they show the same or similar item.
Consider: color, shape, brand logos, size, distinctive features.

Rate similarity from 0 to 100 where:
- 90-100: Almost certainly the same item
- 70-89: Very similar, likely the same
- 50-69: Some similarities but notable differences
- 30-49: Different items with minor similarities
- 0-29: Completely different items

Respond ONLY with JSON: {"score": <number>, "reason": "<brief explanation>"}`;

        const response = await callLLM([
            { role: 'system', content: 'You are an image comparison expert for a lost and found system.' },
            { role: 'user', content: prompt },
        ], {
            imageBase64: searchImageBase64,
            temperature: 0.2,
        });

        const result = parseJSONFromLLM<{ score: number; reason: string }>(response.content);
        return result ? result.score / 100 : 0.5;
    } catch (error) {
        console.error('Image comparison failed:', error);
        return 0.5;
    }
}

/**
 * Find matches for a lost item
 */
export async function findMatchesForLostItem(
    lostItem: {
        name: string;
        description: string;
        tags?: string[];
        location?: string;
        coordinates?: Coordinates;
        date: Date;
        imageBase64?: string;
    }
): Promise<MatchResult[]> {
    // Get all found items that are pending
    const snapshot = await collections.items
        .where('type', '==', 'Found')
        .where('status', '==', 'Pending')
        .get();

    const foundItems = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
    })) as Item[];

    if (foundItems.length === 0) {
        return [];
    }

    // Calculate match scores for each found item
    const matchPromises = foundItems.map(async (item) => {
        const itemDate = item.date instanceof Date
            ? item.date
            : item.date.toDate();

        // Calculate text score (50%)
        const textScore = calculateTextScore(
            item.name,
            item.description,
            item.tags || [],
            lostItem.name,
            lostItem.description,
            lostItem.tags || []
        );

        // Calculate image score (50%) - async
        const imageUrl = item.cloudinaryUrls?.[0] || item.imageUrl;
        const imageScore = await calculateImageScore(imageUrl, lostItem.imageBase64);

        // Calculate weighted total (50% text + 50% image)
        const totalScore =
            textScore * MATCH_WEIGHTS.text +
            imageScore * MATCH_WEIGHTS.image;

        return {
            itemId: item.id,
            item,
            score: Math.round(totalScore * 100),
            breakdown: {
                textScore: Math.round(textScore * 100),
                imageScore: Math.round(imageScore * 100),
            },
        };
    });

    const matches = await Promise.all(matchPromises);

    // Filter by threshold and sort by score
    return matches
        .filter(m => m.score >= SAFETY_LIMITS.MATCH_THRESHOLD_PERCENT)
        .sort((a, b) => b.score - a.score);
}

/**
 * Find matches for a found item (search for lost items)
 */
export async function findMatchesForFoundItem(
    foundItem: {
        name: string;
        description: string;
        tags?: string[];
        coordinates?: Coordinates;
        date: Date;
        imageBase64?: string;
    }
): Promise<MatchResult[]> {
    // Get all lost items that are pending
    const snapshot = await collections.items
        .where('type', '==', 'Lost')
        .where('status', '==', 'Pending')
        .get();

    const lostItems = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
    })) as Item[];

    if (lostItems.length === 0) {
        return [];
    }

    // Similar logic as findMatchesForLostItem
    const matchPromises = lostItems.map(async (item) => {
        const itemDate = item.date instanceof Date
            ? item.date
            : item.date.toDate();

        // Calculate text score (50%)
        const textScore = calculateTextScore(
            item.name,
            item.description,
            item.tags || [],
            foundItem.name,
            foundItem.description,
            foundItem.tags || []
        );

        // Calculate image score (50%)
        const imageUrl = item.cloudinaryUrls?.[0] || item.imageUrl;
        const imageScore = await calculateImageScore(imageUrl, foundItem.imageBase64);

        // Calculate weighted total (50% text + 50% image)
        const totalScore =
            textScore * MATCH_WEIGHTS.text +
            imageScore * MATCH_WEIGHTS.image;

        return {
            itemId: item.id,
            item,
            score: Math.round(totalScore * 100),
            breakdown: {
                textScore: Math.round(textScore * 100),
                imageScore: Math.round(imageScore * 100),
            },
        };
    });

    const matches = await Promise.all(matchPromises);

    return matches
        .filter(m => m.score >= SAFETY_LIMITS.MATCH_THRESHOLD_PERCENT)
        .sort((a, b) => b.score - a.score);
}
