/**
 * Scoring Utilities for Item Matching
 * Shared logic for both Auto-Match and Manual Search
 * 
 * Scoring Breakdown (100 points total):
 * - Tags:        30 points (30%)
 * - Description: 20 points (20%)
 * - Color:       15 points (15%)
 * - Location:    20 points (20%)
 * - Time:        10 points (10%)
 * - Image:        5 points (5%)
 */

import { Match } from '../types/index.js';

export const MATCH_CONFIG = {
    // Scoring weights (must sum to 100)
    WEIGHTS: {
        semantic: 50, // New embedding-based score
        tags: 0,      // Replaced by semantic
        description: 0, // Replaced by semantic
        color: 15,
        location: 20,
        time: 10,
        category: 5,  // Option A: 5% Category Match
        image: 0      // Reallocated to Category
    },

    // Threshold
    THRESHOLD: 75,  // 75% minimum to match (restored from 60)

    // Location scoring tiers (km)
    LOCATION: {
        maxDistance: 10,      // Skip if farther
        tier1: 1,             // 0-1 km: 20 points
        tier2: 2,             // 1-2 km: 15 points
        tier3: 5,             // 2-5 km: 10 points
        tier4: 10             // 5-10 km: 5 points
    },

    // Time scoring tiers (hours)
    TIME: {
        maxHours: 72,         // Skip if farther (increased from 48)
        tier1: 24,            // 0-24 hours: 10 points
        tier2: 48,            // 24-48 hours: 7 points
        tier3: 72,            // 48-72 hours: 5 points
    },

    // Minimum requirements (pre-filters)
    REQUIREMENTS: {
        minCommonTags: 1,
        maxDistance: 10,      // km
        maxTimeDiff: 72       // hours (increased from 48)
    }
};

/**
 * Calculate Haversine distance between two coordinates (in km)
 */
export function haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371; // Earth radius in km
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calculate time difference in hours
 */
export function calculateTimeDifference(date1: Date, date2: Date): number {
    return Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60);
}

/**
 * Helper to combine name and tags for better matching
 */
export function getTagsWithFallback(tags: string[] = [], name: string = ''): string[] {
    const finalTags = new Set((tags || []).map(t => t.toLowerCase().trim()));

    // If name exists, add words from name as potential tags
    if (name) {
        name.toLowerCase()
            .split(/[\s,/-]+/)
            .filter(w => w.length >= 2) // Allow 2 letter words like 'Mi', 'TV'
            .forEach(w => finalTags.add(w));
    }

    return Array.from(finalTags);
}

/**
 * SCORE 1: Tag Matching (0-30 points)
 * Compares tag overlap between two items
 */
export function calculateTagScore(tags1: string[], tags2: string[]): number {
    if ((!tags1 || tags1.length === 0) && (!tags2 || tags2.length === 0)) {
        return 0;
    }

    // Convert to lowercase for comparison
    const set1 = new Set(tags1.map(t => t.toLowerCase().trim()));
    const set2 = new Set(tags2.map(t => t.toLowerCase().trim()));

    // Count common tags
    const commonTags = [...set1].filter(tag => set2.has(tag));

    // Use Overlap Coefficient
    // If Item A has 2 tags and Item B has 10 tags, but they share 2, it's a 100% match for shared info
    const minTags = Math.min(set1.size, set2.size);

    if (minTags === 0) return 0;

    const similarity = commonTags.length / minTags;
    const score = similarity * MATCH_CONFIG.WEIGHTS.tags;

    return Math.round(score * 10) / 10;
}

/**
 * SCORE 2: Description Similarity (0-20 points)
 * Uses Overlap Coefficient on description text
 */
export function calculateDescriptionScore(desc1: string, desc2: string): number {
    if (!desc1 || !desc2) return 0;

    // Remove stop words and extract meaningful words
    const stopWords = new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at',
        'to', 'for', 'of', 'and', 'or', 'my', 'i', 'it', 'this', 'that',
        'with', 'from', 'by', 'as', 'be', 'have', 'has', 'had'
    ]);

    const extractWords = (text: string) => {
        return text
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
    };

    const words1 = new Set(extractWords(desc1));
    const words2 = new Set(extractWords(desc2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = [...words1].filter(w => words2.has(w)).length;

    // Overlap Coefficient is better for matching snippets of info
    const minWords = Math.min(words1.size, words2.size);
    const similarity = intersection / minWords;

    const score = similarity * MATCH_CONFIG.WEIGHTS.description;

    return Math.round(score * 10) / 10;
}

/**
 * SCORE 3: Category Matching (0-5 points)
 * If broad categories match (Electronics vs Electronics)
 */
export function calculateCategoryScore(cat1?: string, cat2?: string): number {
    if (!cat1 || !cat2) return 0;

    // Exact text match (AI produces standard labels)
    if (cat1.toLowerCase().trim() === cat2.toLowerCase().trim()) {
        return MATCH_CONFIG.WEIGHTS.category || 5;
    }

    return 0;
}

/**
 * SCORE 3: Color Matching (0-15 points)
 * Exact match = 15, similar = 10, none = 0
 */
export function calculateColorScore(color1?: string, color2?: string): number {
    if (!color1 || !color2) return 0;

    const c1 = color1.toLowerCase().trim();
    const c2 = color2.toLowerCase().trim();

    // Exact match = 15 points
    if (c1 === c2) {
        return MATCH_CONFIG.WEIGHTS.color;
    }

    // Similar colors = 10 points
    if (areSimilarColors(c1, c2)) {
        return Math.round(MATCH_CONFIG.WEIGHTS.color * 0.67); // ~10 points
    }

    return 0;
}

/**
 * Check if two colors are similar
 */
function areSimilarColors(color1: string, color2: string): boolean {
    const similarGroups = [
        ['black', 'dark grey', 'dark gray', 'charcoal', 'ebony', 'jet black'],
        ['white', 'off-white', 'cream', 'ivory', 'beige', 'pearl'],
        ['red', 'maroon', 'burgundy', 'crimson', 'scarlet'],
        ['blue', 'navy', 'dark blue', 'royal blue', 'sky blue', 'azure'],
        ['green', 'dark green', 'forest green', 'olive', 'emerald', 'lime'],
        ['gray', 'grey', 'silver', 'ash', 'metal', 'gunmetal'],
        ['brown', 'tan', 'khaki', 'chocolate', 'coffee', 'bronze'],
        ['pink', 'light pink', 'rose', 'magenta', 'salmon'],
        ['yellow', 'gold', 'golden', 'mustard'],
        ['orange', 'amber', 'rust'],
        ['purple', 'violet', 'lavender', 'lilac', 'indigo']
    ];

    for (const group of similarGroups) {
        if (group.includes(color1) && group.includes(color2)) {
            return true;
        }
    }

    return false;
}

/**
 * SCORE 4: Location Proximity (0-20 points)
 * Based on distance between coordinates
 */
export function calculateLocationScore(
    coords1?: { lat: number; lng: number },
    coords2?: { lat: number; lng: number },
    loc1?: string,
    loc2?: string
): number {
    // 1. Precise Coordinate Matching (Max 20 points)
    if (coords1 && coords2) {
        const distance = haversineDistance(
            coords1.lat,
            coords1.lng,
            coords2.lat,
            coords2.lng
        );

        // Tiered scoring
        if (distance <= MATCH_CONFIG.LOCATION.tier1) return 20;  // 0-1 km
        if (distance <= MATCH_CONFIG.LOCATION.tier2) return 15;  // 1-2 km
        if (distance <= MATCH_CONFIG.LOCATION.tier3) return 10;  // 2-5 km
        if (distance <= MATCH_CONFIG.LOCATION.tier4) return 5;   // 5-10 km

        return 0; // > 10km is a hard fail for coordinates
    }

    // 2. Text-based Fallback (Max 10 points)
    // If coordinates are missing, we check if the location names are similar
    if (loc1 && loc2) {
        const s1 = loc1.toLowerCase();
        const s2 = loc2.toLowerCase();

        // Exact match of strings (e.g. "College Canteen")
        if (s1 === s2) return 10;

        // Check for common words (e.g. "Rajarajeshwari Nagar" vs "Rajarajeshwari Nagar, Bengaluru")
        const words1 = s1.split(/[\s,]+/).filter(w => w.length > 3);
        const words2 = s2.split(/[\s,]+/).filter(w => w.length > 3);

        const common = words1.filter(w => words2.includes(w));
        if (common.length > 0) return 7; // Significant overlap
    }

    return 0;
}

/**
 * SCORE 5: Time Window (0-10 points)
 * Based on time difference between lost and found
 */
export function calculateTimeScore(date1: Date, date2: Date): number {
    const hoursDiff = calculateTimeDifference(date1, date2);

    // Tiered scoring (Updated as per request)
    if (hoursDiff <= MATCH_CONFIG.TIME.tier1) return 10;  // 0-24 hours
    if (hoursDiff <= MATCH_CONFIG.TIME.tier2) return 7;   // 24-48 hours
    if (hoursDiff <= MATCH_CONFIG.TIME.tier3) return 5;   // 48-72 hours

    return 0; // >72 hours
}
