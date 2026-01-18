/**
 * Auto-Match Service - Comprehensive Matching System
 * Uses shared scoring logic from utils/scoring.ts
 */

import { collections } from '../utils/firebase-admin.js';
import { Item, ItemType } from '../types/index.js';
import { FieldValue } from 'firebase-admin/firestore';
import {
    MATCH_CONFIG,
    calculateColorScore,
    calculateLocationScore,
    calculateTimeScore,
    haversineDistance,
    calculateTimeDifference,
    getTagsWithFallback
} from '../utils/scoring.js';
import { initiateHandover } from './handover.service.js';
import { callLLM } from '../utils/llm.js';
import { compareMultipleImages, isClarifaiConfigured } from './clarifaiMatch.service.js';

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
        console.error('[Ordering] Image comparison failed:', error);
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
        cloudinaryUrls?: string[];
        coordinates?: { lat: number; lng: number };
        location: string;
        category?: string;
        date?: Date;
    }
): Promise<{ bestMatchId?: string; highestScore: number } | null> {
    console.log(`[AUTO-MATCH] ========== STARTING COMPREHENSIVE MATCHING (LLM) ==========`);
    console.log(`[AUTO-MATCH] Item ID: ${itemId}`);
    console.log(`[AUTO-MATCH] Item Type: ${itemType}`);
    console.log(`[AUTO-MATCH] Threshold: ${MATCH_CONFIG.THRESHOLD}%`);

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

            // Filter 1: Tag Overlap (Basic check before expensive LLM)
            const itemTags = getTagsWithFallback(itemData.tags, itemData.name);
            const candidateTags = getTagsWithFallback(candidateData.tags, candidateData.name);

            const commonTags = itemTags.filter(tag =>
                candidateTags.includes(tag)
            );

            if (commonTags.length < MATCH_CONFIG.REQUIREMENTS.minCommonTags) {
                console.log(`[FILTER] ❌ Not enough common tags: ${commonTags.length} < ${MATCH_CONFIG.REQUIREMENTS.minCommonTags} - skipping`);
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

            // Semantic Score (LLM)
            const semanticScore = await calculateSemanticScore(itemData, candidateData);

            // Image Score
            const itemImageUrls = itemData.cloudinaryUrls || (itemData.imageUrl ? [itemData.imageUrl] : []);
            const candidateImageUrls = candidateData.cloudinaryUrls || (candidateData.imageUrl ? [candidateData.imageUrl] : []);
            const hasImages = itemImageUrls.length > 0 && candidateImageUrls.length > 0;

            const imageScore = await calculateImageScore(itemImageUrls, candidateImageUrls);

            // Other Scores
            const colorScore = calculateColorScore(itemData.color, candidateData.color);
            const locationScore = calculateLocationScore(
                itemData.coordinates,
                candidateData.coordinates,
                itemData.location,
                candidateData.location
            );
            const timeScore = calculateTimeScore(itemDate, candidateDate);

            // ================================================================
            // FINAL SCORE CALCULATION
            // ================================================================

            let finalScore = Math.round(
                semanticScore +
                colorScore +
                locationScore +
                timeScore +
                imageScore
            );

            // Normalization for missing images
            if (!hasImages) {
                const maxScoreWithoutImage = 100 - MATCH_CONFIG.WEIGHTS.image;
                finalScore = Math.round((finalScore / maxScoreWithoutImage) * 100);
            }

            console.log(`[MATCH][BREAKDOWN] Semantic:${semanticScore} + Color:${colorScore} + Loc:${locationScore} + Time:${timeScore} + Img:${imageScore} => Raw:${semanticScore + colorScore + locationScore + timeScore + imageScore} / Norm:${finalScore}`);

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
                        tagScore: semanticScore, // Mapped for frontend compatibility
                        descriptionScore: 0,
                        colorScore,
                        categoryScore: 0,
                        locationScore,
                        timeScore,
                        imageScore,
                        matchScore: finalScore,
                        status: 'matched' as const,
                        createdAt: FieldValue.serverTimestamp(),
                    };

                    const matchRef = await collections.matches.add(matchData);
                    console.log(`[AUTO-MATCH] 💾 Match record created: ${matchRef.id}`);

                    // 🔔 INITIATE HANDOVER - Send verification emails
                    try {
                        console.log(`[AUTO-MATCH] 📧 Initiating handover process...`);
                        const handoverResult = await initiateHandover(matchRef.id, lostItemId, foundItemId);
                        if (handoverResult.success) {
                            console.log(`[AUTO-MATCH] ✅ Handover emails sent successfully!`);
                        } else {
                            console.log(`[AUTO-MATCH] ⚠️ Handover initiation issue: ${handoverResult.message}`);
                        }
                    } catch (handoverError) {
                        console.error(`[AUTO-MATCH] ❌ Handover error:`, handoverError);
                        // Don't fail the match - handover can be retried
                    }
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
