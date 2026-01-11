/**
 * Auto-Match Service - Comprehensive Matching System
 * Uses shared scoring logic from utils/scoring.ts
 */

import { collections } from '../utils/firebase-admin.js';
import { Item, ItemType } from '../types/index.js';
import { FieldValue } from 'firebase-admin/firestore';
import {
    MATCH_CONFIG,
    calculateTagScore,
    calculateDescriptionScore,
    calculateColorScore,
    calculateCategoryScore,
    calculateLocationScore,
    calculateTimeScore,
    haversineDistance,
    calculateTimeDifference,
    getTagsWithFallback
} from '../utils/scoring.js';
import { calculateCosineSimilarity } from '../utils/embeddings.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Convert Firestore Timestamp to Date
 */
function toDate(timestamp: any): Date {
    if (timestamp instanceof Date) return timestamp;
    if (timestamp?.toDate) return timestamp.toDate();
    if (timestamp?.seconds) return new Date(timestamp.seconds * 1000);
    return new Date(timestamp);
}

// ============================================================================
// MAIN MATCHING FUNCTION
// ============================================================================

/**
 * Trigger automatic matching for a newly created item
 * Uses comprehensive 6-factor scoring system
 */
export async function triggerAutoMatching(
    itemId: string,
    itemType: ItemType,
    itemData: {
        name: string;
        description: string;
        tags: string[];
        color?: string;
        imageUrl?: string;
        coordinates?: { lat: number; lng: number };
        location: string;
        category?: string;
        date?: Date;
        embedding?: number[];
    }
): Promise<{ bestMatchId?: string; highestScore: number } | null> {
    console.log(`[AUTO-MATCH] ========== STARTING COMPREHENSIVE MATCHING (VECTOR) ==========`);
    console.log(`[AUTO-MATCH] Item ID: ${itemId}`);
    console.log(`[AUTO-MATCH] Item Type: ${itemType}`);
    console.log(`[AUTO-MATCH] Threshold: ${MATCH_CONFIG.THRESHOLD}%`);
    console.log(`[AUTO-MATCH] Vector Present: ${itemData.embedding && itemData.embedding.length > 0 ? 'YES' : 'NO'}`);

    try {
        // Determine opposite type
        const oppositeType: ItemType = itemType === 'Lost' ? 'Found' : 'Lost';

        // Fetch all opposite-type items with Pending status
        const snapshot = await collections.items
            .where('type', '==', oppositeType)
            .where('status', '==', 'Pending')
            .get();

        const candidates = snapshot.docs;
        console.log(`[AUTO-MATCH] Candidates found: ${candidates.length}`);
        console.log(`[AUTO-MATCH] Candidate List: ${candidates.map(c => `${c.id} (${(c.data() as any).name})`).join(', ')}`);

        if (candidates.length === 0) {
            console.log('[AUTO-MATCH] No candidates to match against');
            return { highestScore: 0 };
        }

        let highestScore = 0;
        let bestMatchId = '';

        // Get item date
        const itemDate = itemData.date || new Date();

        // Compare with each candidate
        for (const candidateDoc of candidates) {
            const candidateData = candidateDoc.data() as Item;
            const candidateId = candidateDoc.id;

            console.log(`\n[AUTO-MATCH] --- Checking candidate ${candidateId} (${candidateData.name}) ---`);

            // ================================================================
            // PRE-FILTERS (Must pass all to continue)
            // ================================================================

            // Improved Tag Matching with Name Fallback
            const itemTags = getTagsWithFallback(itemData.tags, itemData.name);
            const candidateTags = getTagsWithFallback(candidateData.tags, candidateData.name);

            const commonTags = itemTags.filter(tag =>
                candidateTags.includes(tag)
            );

            if (commonTags.length < MATCH_CONFIG.REQUIREMENTS.minCommonTags) {
                console.log(`[FILTER] ❌ Not enough common tags: ${commonTags.length} < ${MATCH_CONFIG.REQUIREMENTS.minCommonTags} - skipping`);
                console.log(`         Item tags: ${JSON.stringify(itemTags)}`);
                console.log(`         Cand tags: ${JSON.stringify(candidateTags)}`);
                continue;
            }

            // Filter 2: Location within max distance
            if (itemData.coordinates && candidateData.coordinates) {
                const distance = haversineDistance(
                    itemData.coordinates.lat,
                    itemData.coordinates.lng,
                    candidateData.coordinates.lat,
                    candidateData.coordinates.lng
                );

                if (distance > MATCH_CONFIG.REQUIREMENTS.maxDistance) {
                    console.log(`[FILTER] ❌ Too far: ${distance.toFixed(2)}km > ${MATCH_CONFIG.REQUIREMENTS.maxDistance}km - skipping`);
                    continue;
                }
            }

            // Filter 3: Time within max window
            const candidateDate = toDate(candidateData.date);
            const timeDiff = calculateTimeDifference(itemDate, candidateDate);

            if (timeDiff > MATCH_CONFIG.REQUIREMENTS.maxTimeDiff) {
                console.log(`[FILTER] ❌ Too old: ${timeDiff.toFixed(1)}h > ${MATCH_CONFIG.REQUIREMENTS.maxTimeDiff}h - skipping`);
                continue;
            }

            console.log(`[FILTER] ✅ Passed all pre-filters`);

            // ================================================================
            // CALCULATE ALL SCORES
            // ================================================================

            // Semantic Score (Embeddings)
            let semanticScore = 0;
            if (itemData.embedding && candidateData.embedding) {
                const similarity = calculateCosineSimilarity(itemData.embedding, candidateData.embedding);
                semanticScore = Math.round(similarity * MATCH_CONFIG.WEIGHTS.semantic * 10) / 10;
                console.log(`[MATCH] Vector Similarity: ${(similarity * 100).toFixed(1)}% -> Points: ${semanticScore}`);
            } else {
                console.log(`[MATCH] skipping vector match (missing embeddings)`);
            }

            const combinedItemDesc = `${itemData.name} ${itemData.description || ''}`;
            const combinedCandidateDesc = `${candidateData.name} ${candidateData.description || ''}`;

            const tagScore = calculateTagScore(itemTags, candidateTags);
            const descriptionScore = calculateDescriptionScore(combinedItemDesc, combinedCandidateDesc);
            const colorScore = calculateColorScore(itemData.color, candidateData.color);
            const categoryScore = calculateCategoryScore(itemData.category, candidateData.category);
            const locationScore = calculateLocationScore(
                itemData.coordinates,
                candidateData.coordinates,
                itemData.location,
                candidateData.location
            );
            const timeScore = calculateTimeScore(itemDate, candidateDate);

            // Image score disabled for now
            const imageScore = 0;

            // ================================================================
            // FINAL SCORE CALCULATION
            // ================================================================

            const finalScore = Math.round(
                semanticScore +
                tagScore +
                descriptionScore +
                colorScore +
                categoryScore +
                locationScore +
                timeScore +
                imageScore
            );

            console.log(`[MATCH][BREAKDOWN] Semantic:${semanticScore} + Tag:${tagScore} + Desc:${descriptionScore} + Color:${colorScore} + Cat:${categoryScore} + Loc:${locationScore} + Time:${timeScore} + Img:${imageScore}`);

            // Update highest score found (tracked even if below threshold)
            if (finalScore > highestScore) {
                highestScore = finalScore;
                bestMatchId = candidateId;
            }

            // Check if this is a match (score >= threshold)
            if (finalScore >= MATCH_CONFIG.THRESHOLD) {
                console.log(`[MATCH] ✅ MATCH FOUND! Score: ${finalScore}% >= ${MATCH_CONFIG.THRESHOLD}%`);

                // Determine which is lost and which is found
                const lostItemId = itemType === 'Lost' ? itemId : candidateId;
                const foundItemId = itemType === 'Found' ? itemId : candidateId;

                // Check if match already exists
                const existingMatch = await collections.matches
                    .where('lostItemId', '==', lostItemId)
                    .where('foundItemId', '==', foundItemId)
                    .get();

                if (existingMatch.empty) {
                    // Create new match record with comprehensive scores
                    const matchData = {
                        lostItemId,
                        foundItemId,
                        semanticScore,
                        tagScore,
                        descriptionScore,
                        colorScore,
                        categoryScore,
                        locationScore,
                        timeScore,
                        imageScore,
                        matchScore: finalScore,
                        status: 'matched' as const,
                        createdAt: FieldValue.serverTimestamp(),
                    };

                    const matchRef = await collections.matches.add(matchData);
                    console.log(`[AUTO-MATCH] 💾 Match record created: ${matchRef.id}`);
                }

                // Track highest score for updating item status
                if (finalScore > highestScore) {
                    highestScore = finalScore;
                    bestMatchId = candidateId;
                    console.log(`[AUTO-MATCH] 🏆 New highest score: ${finalScore}%`);
                }
            } else {
                console.log(`[MATCH] ❌ No match: Score ${finalScore}% < ${MATCH_CONFIG.THRESHOLD}% threshold`);
            }
        }

        // Always update the item with its highest discovered match score for UI visibility
        if (highestScore > 0) {
            console.log(`[MATCH][DB] Updating item ${itemId} with highestScore: ${highestScore}%`);
            await collections.items.doc(itemId).update({
                matchScore: highestScore
            });
        }

        // If we found at least one match, update both items' status
        if (highestScore >= MATCH_CONFIG.THRESHOLD) {
            console.log(`\n[AUTO-MATCH] 🎯 Updating item statuses to "Matched"`);

            // Update new item
            await collections.items.doc(itemId).update({
                status: 'Matched',
                matchScore: highestScore,
                matchedItemId: bestMatchId,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Update matched item
            await collections.items.doc(bestMatchId).update({
                status: 'Matched',
                matchScore: highestScore,
                matchedItemId: itemId,
                updatedAt: FieldValue.serverTimestamp(),
            });

            console.log(`[AUTO-MATCH] 🎉 Matching complete!`);
        } else {
            console.log(`\n[AUTO-MATCH] ℹ️  No matches found`);
        }

        return { bestMatchId, highestScore };

    } catch (error) {
        console.error(`[AUTO-MATCH] ❌ ERROR during matching for item ${itemId}:`, error);
        throw error;
    }
}
