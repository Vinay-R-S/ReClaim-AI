/**
 * Matching Service - Find potential matches between lost and found items
 */

import { collections } from '../utils/firebase-admin.js';
import { callLLM, parseJSONFromLLM } from '../utils/llm.js';
import { Item, MatchResult, SAFETY_LIMITS, Coordinates } from '../types/index.js';

// Weights for different matching criteria
const MATCH_WEIGHTS = {
    text: 0.40,      // 40% - name, description, tags
    location: 0.30,  // 30% - proximity within radius
    time: 0.15,      // 15% - date closeness
    image: 0.15,     // 15% - AI vision comparison
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in kilometers
 */
function calculateDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(coord2.lat - coord1.lat);
    const dLon = toRad(coord2.lng - coord1.lng);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(coord1.lat)) * Math.cos(toRad(coord2.lat)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(deg: number): number {
    return deg * (Math.PI / 180);
}

/**
 * Calculate location score based on distance
 */
function calculateLocationScore(
    itemCoords?: Coordinates,
    searchCoords?: Coordinates
): number {
    if (!itemCoords || !searchCoords) {
        return 0.5; // Neutral score if coordinates missing
    }

    const distance = calculateDistance(itemCoords, searchCoords);
    const maxRadius = SAFETY_LIMITS.LOCATION_RADIUS_KM;

    if (distance <= maxRadius) {
        // Linear decay from 1.0 at 0km to 0.7 at max radius
        return 1 - (distance / maxRadius) * 0.3;
    } else if (distance <= maxRadius * 2) {
        // Extended range: 0.7 at max radius to 0.3 at 2x radius
        return 0.7 - ((distance - maxRadius) / maxRadius) * 0.4;
    }

    return 0.1; // Minimal score for far items
}

/**
 * Calculate time proximity score
 */
function calculateTimeScore(itemDate: Date, searchDate: Date): number {
    const diffDays = Math.abs(
        (itemDate.getTime() - searchDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays <= 1) return 1.0;      // Same day or next day
    if (diffDays <= 3) return 0.9;      // Within 3 days
    if (diffDays <= 7) return 0.7;      // Within a week
    if (diffDays <= 14) return 0.5;     // Within 2 weeks
    if (diffDays <= 30) return 0.3;     // Within a month

    return 0.1; // Older items
}

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

        // Calculate individual scores
        const textScore = calculateTextScore(
            item.name,
            item.description,
            item.tags || [],
            lostItem.name,
            lostItem.description,
            lostItem.tags || []
        );

        const locationScore = calculateLocationScore(
            item.coordinates,
            lostItem.coordinates
        );

        const timeScore = calculateTimeScore(itemDate, lostItem.date);

        // Image score is async
        const imageUrl = item.cloudinaryUrls?.[0] || item.imageUrl;
        const imageScore = await calculateImageScore(imageUrl, lostItem.imageBase64);

        // Calculate weighted total
        const totalScore =
            textScore * MATCH_WEIGHTS.text +
            locationScore * MATCH_WEIGHTS.location +
            timeScore * MATCH_WEIGHTS.time +
            imageScore * MATCH_WEIGHTS.image;

        return {
            itemId: item.id,
            item,
            score: Math.round(totalScore * 100),
            breakdown: {
                textScore: Math.round(textScore * 100),
                locationScore: Math.round(locationScore * 100),
                timeScore: Math.round(timeScore * 100),
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

        const textScore = calculateTextScore(
            item.name,
            item.description,
            item.tags || [],
            foundItem.name,
            foundItem.description,
            foundItem.tags || []
        );

        const locationScore = calculateLocationScore(
            item.coordinates,
            foundItem.coordinates
        );

        const timeScore = calculateTimeScore(itemDate, foundItem.date);

        const imageUrl = item.cloudinaryUrls?.[0] || item.imageUrl;
        const imageScore = await calculateImageScore(imageUrl, foundItem.imageBase64);

        const totalScore =
            textScore * MATCH_WEIGHTS.text +
            locationScore * MATCH_WEIGHTS.location +
            timeScore * MATCH_WEIGHTS.time +
            imageScore * MATCH_WEIGHTS.image;

        return {
            itemId: item.id,
            item,
            score: Math.round(totalScore * 100),
            breakdown: {
                textScore: Math.round(textScore * 100),
                locationScore: Math.round(locationScore * 100),
                timeScore: Math.round(timeScore * 100),
                imageScore: Math.round(imageScore * 100),
            },
        };
    });

    const matches = await Promise.all(matchPromises);

    return matches
        .filter(m => m.score >= SAFETY_LIMITS.MATCH_THRESHOLD_PERCENT)
        .sort((a, b) => b.score - a.score);
}
