/**
 * Matching Service - Find potential matches between lost and found items
 * Uses shared scoring logic from utils/scoring.ts
 */

import { collections } from '../utils/firebase-admin.js';
import { Item, MatchResult, Coordinates } from '../types/index.js';
import {
    MATCH_CONFIG,
    calculateTagScore,
    calculateDescriptionScore,
    calculateColorScore,
    calculateLocationScore,
    calculateTimeScore,
    haversineDistance,
    calculateTimeDifference
} from '../utils/scoring.js';

/**
 * Calculate image similarity using AI vision
 */
async function calculateImageScore(
    itemImageUrl?: string,
    searchImageBase64?: string
): Promise<number> {
    // Image matching disabled per user request (unreliable)
    // Can be re-enabled later with Clarifai or other service
    return 0;
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

        // Pre-filter: Check distance
        if (lostItem.coordinates && item.coordinates) {
            const dist = haversineDistance(
                lostItem.coordinates.lat, lostItem.coordinates.lng,
                item.coordinates.lat, item.coordinates.lng
            );
            if (dist > MATCH_CONFIG.REQUIREMENTS.maxDistance) {
                return null;
            }
        }

        // Pre-filter: Check time
        const timeDiff = calculateTimeDifference(itemDate, searchDate);
        if (timeDiff > MATCH_CONFIG.REQUIREMENTS.maxTimeDiff) {
            return null;
        }

        // Calculate scores
        const tagScore = calculateTagScore(lostItem.tags || [], item.tags || []);

        // Pre-filter: Tags
        // Note: autoMatch enforces minCommonTags=1. We should probably do same here,
        // but for manual search we might want to be more lenient?
        // Let's stick to the config for consistency.
        // Check overlap
        const commonTags = (lostItem.tags || []).filter(t =>
            (item.tags || []).map(it => it.toLowerCase()).includes(t.toLowerCase())
        );
        if (commonTags.length < MATCH_CONFIG.REQUIREMENTS.minCommonTags) {
            // Exception: if valid name match or description match, maybe include?
            // But config says requirement.
            return null;
        }

        const descriptionScore = calculateDescriptionScore(lostItem.description || '', item.description || '');
        const colorScore = calculateColorScore(lostItem.color || '', item.color || ''); // item.color is not in Item type yet? It is in Firestore.
        // Wait, Item interface has color? Yes, I added it in autoMatch but let's check definition.

        const locationScore = calculateLocationScore(lostItem.coordinates, item.coordinates);
        const timeScore = calculateTimeScore(searchDate, itemDate);

        // Image score
        const imageUrl = item.cloudinaryUrls?.[0] || item.imageUrl;
        const imageScore = await calculateImageScore(imageUrl, lostItem.imageBase64);

        const totalScore = Math.round(
            tagScore + descriptionScore + colorScore + locationScore + timeScore + imageScore
        );

        if (totalScore < MATCH_CONFIG.THRESHOLD) {
            return null;
        }

        return {
            itemId: item.id,
            item,
            score: totalScore,
            breakdown: {
                tagScore,
                descriptionScore,
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

        // Pre-filter: Check distance
        if (foundItem.coordinates && item.coordinates) {
            const dist = haversineDistance(
                foundItem.coordinates.lat, foundItem.coordinates.lng,
                item.coordinates.lat, item.coordinates.lng
            );
            if (dist > MATCH_CONFIG.REQUIREMENTS.maxDistance) {
                return null;
            }
        }

        // Pre-filter: Check time
        const timeDiff = calculateTimeDifference(itemDate, searchDate);
        if (timeDiff > MATCH_CONFIG.REQUIREMENTS.maxTimeDiff) {
            return null;
        }

        // Calculate scores
        const tagScore = calculateTagScore(foundItem.tags || [], item.tags || []);

        const commonTags = (foundItem.tags || []).filter(t =>
            (item.tags || []).map(it => it.toLowerCase()).includes(t.toLowerCase())
        );
        if (commonTags.length < MATCH_CONFIG.REQUIREMENTS.minCommonTags) {
            return null;
        }

        const descriptionScore = calculateDescriptionScore(foundItem.description || '', item.description || '');
        const colorScore = calculateColorScore(foundItem.color || '', item.color || '');

        const locationScore = calculateLocationScore(foundItem.coordinates, item.coordinates);
        const timeScore = calculateTimeScore(searchDate, itemDate);

        const imageUrl = item.cloudinaryUrls?.[0] || item.imageUrl;
        const imageScore = await calculateImageScore(imageUrl, foundItem.imageBase64);

        const totalScore = Math.round(
            tagScore + descriptionScore + colorScore + locationScore + timeScore + imageScore
        );

        if (totalScore < MATCH_CONFIG.THRESHOLD) {
            return null;
        }

        return {
            itemId: item.id,
            item,
            score: totalScore,
            breakdown: {
                tagScore,
                descriptionScore,
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
