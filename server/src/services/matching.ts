/**
 * Matching Service - Find potential matches between lost and found items
 * Uses shared scoring logic from utils/scoring.ts
 */

import { collections } from '../utils/firebase-admin.js';
import { Item, MatchResult, Coordinates } from '../types/index.js';
import {
    MATCH_CONFIG,
    calculateColorScore,
    calculateLocationScore,
    calculateTimeScore,
    haversineDistance,
    calculateTimeDifference
} from '../utils/scoring.js';
import { compareMultipleImages, isClarifaiConfigured } from './clarifaiMatch.service.js';
import { callLLM } from '../utils/llm.js';

/**
 * Calculate image similarity using Clarifai
 * Supports multiple images per item
 */
async function calculateImageScore(
    itemImageUrls: string[],
    searchImageUrls: string[]
): Promise<number> {
    // Check if Clarifai is configured
    if (!isClarifaiConfigured()) {
        return 0;
    }

    // If no images on either side, return 0
    if (!itemImageUrls.length || !searchImageUrls.length) {
        return 0;
    }

    try {
        // Use multi-image comparison
        const similarity = await compareMultipleImages(itemImageUrls, searchImageUrls);
        // Convert 0-100 score to weighted match score
        return Math.round((similarity / 100) * MATCH_CONFIG.WEIGHTS.image);
    } catch (error) {
        console.error('[Matching] Image comparison failed:', error);
        return 0;
    }
}

/**
 * Calculate semantic similarity using LLM
 * Compares Name, Description, and Tags
 */
async function calculateSemanticScore(
    item1: { name: string; description: string; tags?: string[] },
    item2: { name: string; description: string; tags?: string[] }
): Promise<number> {
    try {
        const prompt = `Compare these two items and determine if they are likely the same object.
        
Item A:
Name: ${item1.name}
Description: ${item1.description}
Tags: ${item1.tags?.join(', ') || 'None'}

Item B:
Name: ${item2.name}
Description: ${item2.description}
Tags: ${item2.tags?.join(', ') || 'None'}

Ignore minor spelling differences or rigid character matching. Focus on the MEANING and SEMANTIC similarity.
Are they describing the same thing?

Return ONLY a number from 0 to 100 representing the probability they are the same item.
0 = Definitely different
100 = Definitely identical`;

        const response = await callLLM([
            { role: 'system', content: 'You are a semantic matching engine for lost and found items. Output only a number.' },
            { role: 'user', content: prompt }
        ], { temperature: 0.1 });

        const score = parseInt(response.content.replace(/[^0-9]/g, ''));

        if (isNaN(score)) return 0;

        // Scale to the semantic weight
        return Math.round((Math.min(100, Math.max(0, score)) / 100) * MATCH_CONFIG.WEIGHTS.semantic);
    } catch (error) {
        console.error('[Matching] Semantic score failed:', error);
        return 0;
    }
}

/**
 * Helper to convert item date
 */
function toDate(dateVal: any): Date {
    if (dateVal instanceof Date) return dateVal;
    if (dateVal?.toDate) return dateVal.toDate();
    if (dateVal?.seconds) return new Date(dateVal.seconds * 1000);
    return new Date(dateVal || Date.now());
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
        color?: string;
        imageBase64?: string;
        cloudinaryUrls?: string[];
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

    // Process all candidates
    const matchPromises = foundItems.map(async (item) => {
        const itemDate = toDate(item.date);
        const searchDate = toDate(lostItem.date);

        // 1. Hard Filter: Distance
        if (lostItem.coordinates && item.coordinates) {
            const dist = haversineDistance(
                lostItem.coordinates.lat, lostItem.coordinates.lng,
                item.coordinates.lat, item.coordinates.lng
            );
            if (dist > MATCH_CONFIG.REQUIREMENTS.maxDistance) {
                return null;
            }
        }

        // 2. Hard Filter: Time
        const timeDiff = calculateTimeDifference(itemDate, searchDate);
        if (timeDiff > MATCH_CONFIG.REQUIREMENTS.maxTimeDiff) {
            return null;
        }

        // 3. Calculate Scores
        // Image score
        const itemImageUrls = item.cloudinaryUrls || (item.imageUrl ? [item.imageUrl] : []);
        const searchImageUrls = lostItem.cloudinaryUrls || [];
        const hasImages = itemImageUrls.length > 0 && searchImageUrls.length > 0;

        const imageScore = await calculateImageScore(itemImageUrls, searchImageUrls);
        const semanticScore = await calculateSemanticScore(lostItem, item);
        const colorScore = calculateColorScore(lostItem.color || '', item.color || '');
        const locationScore = calculateLocationScore(lostItem.coordinates, item.coordinates, lostItem.location, item.location);
        const timeScore = calculateTimeScore(searchDate, itemDate);

        let totalScore = Math.round(
            semanticScore + colorScore + locationScore + timeScore + imageScore
        );

        // Normalization for missing images
        // If image matching was impossible (one side has no images), we shouldn't penalize
        // Max possible score without image is 80 (100 - 20)
        if (!hasImages) {
            const maxScoreWithoutImage = 100 - MATCH_CONFIG.WEIGHTS.image;
            totalScore = Math.round((totalScore / maxScoreWithoutImage) * 100);
        }

        if (totalScore < MATCH_CONFIG.THRESHOLD) {
            return null;
        }

        return {
            itemId: item.id,
            item,
            score: totalScore,
            breakdown: {
                tagScore: semanticScore, // Mapping semantic to tagScore for frontend compatibility
                descriptionScore: 0,
                colorScore,
                locationScore,
                timeScore,
                imageScore
            },
        };
    });

    const matches = (await Promise.all(matchPromises)).filter(m => m !== null) as MatchResult[];

    return matches.sort((a, b) => b.score - a.score);
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
        color?: string;
        imageBase64?: string;
        cloudinaryUrls?: string[];
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

    // Process all candidates
    const matchPromises = lostItems.map(async (item) => {
        const itemDate = toDate(item.date);
        const searchDate = toDate(foundItem.date);

        // 1. Hard Filter: Distance
        if (foundItem.coordinates && item.coordinates) {
            const dist = haversineDistance(
                foundItem.coordinates.lat, foundItem.coordinates.lng,
                item.coordinates.lat, item.coordinates.lng
            );
            if (dist > MATCH_CONFIG.REQUIREMENTS.maxDistance) {
                return null;
            }
        }

        // 2. Hard Filter: Time
        const timeDiff = calculateTimeDifference(itemDate, searchDate);
        if (timeDiff > MATCH_CONFIG.REQUIREMENTS.maxTimeDiff) {
            return null;
        }

        // 3. Calculate Scores
        const itemImageUrls = item.cloudinaryUrls || (item.imageUrl ? [item.imageUrl] : []);
        const searchImageUrls = foundItem.cloudinaryUrls || [];
        const hasImages = itemImageUrls.length > 0 && searchImageUrls.length > 0;

        const imageScore = await calculateImageScore(itemImageUrls, searchImageUrls);
        const semanticScore = await calculateSemanticScore(foundItem, item);
        const colorScore = calculateColorScore(foundItem.color || '', item.color || '');
        const locationScore = calculateLocationScore(foundItem.coordinates, item.coordinates, undefined, item.location);
        const timeScore = calculateTimeScore(searchDate, itemDate);

        let totalScore = Math.round(
            semanticScore + colorScore + locationScore + timeScore + imageScore
        );

        // Normalization for missing images
        if (!hasImages) {
            const maxScoreWithoutImage = 100 - MATCH_CONFIG.WEIGHTS.image;
            totalScore = Math.round((totalScore / maxScoreWithoutImage) * 100);
        }

        if (totalScore < MATCH_CONFIG.THRESHOLD) {
            return null;
        }

        return {
            itemId: item.id,
            item,
            score: totalScore,
            breakdown: {
                tagScore: semanticScore,
                descriptionScore: 0,
                colorScore,
                locationScore,
                timeScore,
                imageScore
            },
        };
    });

    const matches = (await Promise.all(matchPromises)).filter(m => m !== null) as MatchResult[];

    return matches.sort((a, b) => b.score - a.score);
}
