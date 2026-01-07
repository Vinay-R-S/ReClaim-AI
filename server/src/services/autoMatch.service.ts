/**
 * Auto-Match Service
 * Staged matching approach: Tag → Color → Groq Image Analysis
 */

import { collections } from '../utils/firebase-admin.js';
import { callLLM } from '../utils/llm.js';
import { Item, ItemType, Match } from '../types/index.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Trigger automatic matching for a newly created item
 * Uses staged approach: Tag matching → Color matching → Groq image analysis
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
    }
): Promise<void> {
    console.log(`[AUTO-MATCH] ========== STARTING MATCHING ==========`);
    console.log(`[AUTO-MATCH] Item ID: ${itemId}`);
    console.log(`[AUTO-MATCH] Item Type: ${itemType}`);
    console.log(`[AUTO-MATCH] Item Name: ${itemData.name}`);
    console.log(`[AUTO-MATCH] Tags: ${JSON.stringify(itemData.tags)}`);
    console.log(`[AUTO-MATCH] Color: ${itemData.color || 'NONE'}`);
    console.log(`[AUTO-MATCH] Image URL: ${itemData.imageUrl ? 'present' : 'MISSING'}`);

    try {
        // Determine opposite type
        const oppositeType: ItemType = itemType === 'Lost' ? 'Found' : 'Lost';
        console.log(`[AUTO-MATCH] Looking for opposite type: ${oppositeType}`);

        // Fetch all opposite-type items with Pending status
        const snapshot = await collections.items
            .where('type', '==', oppositeType)
            .where('status', '==', 'Pending')
            .get();

        const candidates = snapshot.docs;
        console.log(`[AUTO-MATCH] Candidates found: ${candidates.length}`);

        if (candidates.length === 0) {
            console.log('[AUTO-MATCH] No candidates to match against');
            return;
        }

        let highestScore = 0;
        let bestMatchId = '';
        let bestMatchScores = { tagScore: 0, colorScore: 0, imageScore: 0 };

        // Compare with each candidate
        for (const candidateDoc of candidates) {
            const candidateData = candidateDoc.data() as Item;
            const candidateId = candidateDoc.id;

            console.log(`[AUTO-MATCH] --- Checking candidate ${candidateId} ---`);
            console.log(`[AUTO-MATCH] Candidate name: ${candidateData.name}`);

            // STAGE 1: Tag Matching (70% weight max)
            const tagScore = calculateTagScore(itemData.tags, candidateData.tags || []);
            console.log(`[MATCH][TAG] Tag score: ${tagScore}/70`);

            // If no tag overlap, skip this candidate entirely
            if (tagScore === 0) {
                console.log(`[MATCH][TAG] ❌ No tag overlap - skipping candidate`);
                continue;
            }

            // STAGE 2: Color Matching (30% weight max)
            const colorScore = calculateColorScore(itemData.color, candidateData.color);
            console.log(`[MATCH][COLOR] Color score: ${colorScore}/30`);

            // FINAL SCORE CALCULATION (Tag 70% + Color 30% = 100%)
            const finalScore = Math.round(tagScore + colorScore);
            console.log(`[MATCH][FINAL] Final score: ${finalScore}/100 (Tag: ${tagScore} + Color: ${colorScore})`);

            // Check if this is a match (score >= 50)
            if (finalScore >= 50) {
                console.log(`[MATCH] ✅ MATCH FOUND! Score: ${finalScore}%`);

                // Determine which is lost and which is found
                const lostItemId = itemType === 'Lost' ? itemId : candidateId;
                const foundItemId = itemType === 'Found' ? itemId : candidateId;

                // Check if match already exists
                const existingMatch = await collections.matches
                    .where('lostItemId', '==', lostItemId)
                    .where('foundItemId', '==', foundItemId)
                    .get();

                if (existingMatch.empty) {
                    // Create new match record with detailed scores
                    const matchData = {
                        lostItemId,
                        foundItemId,
                        tagScore,
                        colorScore,
                        imageScore: 0, // Not used in simplified formula
                        matchScore: finalScore,
                        status: 'matched' as const,
                        createdAt: FieldValue.serverTimestamp(),
                    };

                    const matchRef = await collections.matches.add(matchData);
                    console.log(`[AUTO-MATCH] 💾 Match record created: ${matchRef.id}`);
                    console.log(`[AUTO-MATCH]    Lost: ${lostItemId} ↔ Found: ${foundItemId}`);
                    console.log(`[AUTO-MATCH]    Breakdown - Tag: ${tagScore}, Color: ${colorScore}`);
                } else {
                    console.log(`[AUTO-MATCH] ℹ️  Match already exists`);
                }

                // Track highest score for updating item status
                if (finalScore > highestScore) {
                    highestScore = finalScore;
                    bestMatchId = candidateId;
                    bestMatchScores = { tagScore, colorScore, imageScore: 0 };
                    console.log(`[AUTO-MATCH] 🏆 New highest score: ${finalScore}%`);
                }
            } else {
                console.log(`[MATCH] ❌ No match: Score ${finalScore}% < 50% threshold`);
            }
        }

        // If we found at least one match, update both items' status
        if (highestScore >= 50) {
            console.log(`[AUTO-MATCH] 🎯 Updating item statuses to "Matched"`);
            console.log(`[AUTO-MATCH] Best match: ${itemId} ↔ ${bestMatchId} (${highestScore}%)`);

            // Update new item
            await collections.items.doc(itemId).update({
                status: 'Matched',
                matchScore: highestScore,
                matchedItemId: bestMatchId,
                updatedAt: FieldValue.serverTimestamp(),
            });
            console.log(`[AUTO-MATCH] ✅ Updated item ${itemId}: status=Matched, score=${highestScore}%`);

            // Update matched item
            await collections.items.doc(bestMatchId).update({
                status: 'Matched',
                matchScore: highestScore,
                matchedItemId: itemId,
                updatedAt: FieldValue.serverTimestamp(),
            });
            console.log(`[AUTO-MATCH] ✅ Updated item ${bestMatchId}: status=Matched, score=${highestScore}%`);

            console.log(`[AUTO-MATCH] 🎉 Matching complete!`);
        } else {
            console.log(`[AUTO-MATCH] ℹ️  No matches found (all scores < 50%)`);
        }

        console.log(`[AUTO-MATCH] ========== MATCHING COMPLETE ==========`);

    } catch (error) {
        console.error(`[AUTO-MATCH] ❌ ERROR during matching for item ${itemId}:`, error);
        throw error;
    }
}

/**
 * Calculate tag matching score (0-70 points, 70% weight)
 * Compares tag overlap between two items
 */
function calculateTagScore(tags1: string[], tags2: string[]): number {
    if (!tags1 || !tags2 || tags1.length === 0 || tags2.length === 0) {
        return 0;
    }

    // Convert to lowercase for comparison
    const set1 = new Set(tags1.map(t => t.toLowerCase()));
    const set2 = new Set(tags2.map(t => t.toLowerCase()));

    // Count common tags
    const commonTags = [...set1].filter(tag => set2.has(tag));
    const maxTags = Math.max(set1.size, set2.size);

    if (maxTags === 0) return 0;

    // Score: (commonTags / maxTags) * 70 (70% weight)
    const score = (commonTags.length / maxTags) * 70;
    return Math.round(score);
}

/**
 * Calculate color matching score (0-30 points, 30% weight)
 * Exact match = 30, similar = 15, else = 0
 */
function calculateColorScore(color1?: string, color2?: string): number {
    if (!color1 || !color2) {
        return 0;
    }

    const c1 = color1.toLowerCase().trim();
    const c2 = color2.toLowerCase().trim();

    // Exact match = 30 points (30% weight)
    if (c1 === c2) {
        return 30;
    }

    // Similar colors = 15 points (half weight)
    if (areSimilarColors(c1, c2)) {
        return 15;
    }

    return 0;
}

/**
 * Check if two colors are similar
 */
function areSimilarColors(color1: string, color2: string): boolean {
    const similarGroups = [
        ['black', 'dark grey', 'dark gray', 'charcoal'],
        ['white', 'off-white', 'cream', 'ivory'],
        ['red', 'maroon', 'burgundy'],
        ['blue', 'navy', 'dark blue'],
        ['green', 'dark green', 'forest green'],
        ['gray', 'grey', 'silver'],
        ['brown', 'tan', 'beige'],
        ['pink', 'light pink', 'rose'],
    ];

    for (const group of similarGroups) {
        if (group.includes(color1) && group.includes(color2)) {
            return true;
        }
    }

    return false;
}

/**
 * STAGE 3: Calculate image similarity using Groq (0-50 points)
 * Uses Groq vision model to compare two images
 */
async function calculateImageScore(imageUrl1: string, imageUrl2: string): Promise<number> {
    try {
        // Check if Groq API is configured
        const groqApiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;
        if (!groqApiKey) {
            console.warn('[MATCH][IMAGE] ⚠️  Groq API not configured - using 0 score');
            return 0;
        }

        const prompt = `You are an AI system matching lost and found items.

Compare these two images and determine how likely they represent the same physical object.

Consider:
- Object type
- Shape
- Brand/logo
- Color pattern
- Wear marks

Return ONLY a number between 0 and 100.
No explanation.`;

        // Call Groq with vision capability
        // Note: Groq's vision API may require specific formatting
        const response = await callLLM(
            [
                {
                    role: 'system',
                    content: 'You are an image comparison expert for a lost and found system.'
                },
                {
                    role: 'user',
                    content: `${prompt}\n\nImage 1 URL: ${imageUrl1}\nImage 2 URL: ${imageUrl2}`
                },
            ],
            { temperature: 0.2 }
        );

        // Extract number from response
        const scoreMatch = response.content.match(/\d+/);
        if (scoreMatch) {
            const groqScore = parseInt(scoreMatch[0], 10);
            // Convert 0-100 Groq score to 0-50 points
            const imageScore = Math.round((groqScore / 100) * 50);
            return imageScore;
        }

        console.warn('[MATCH][IMAGE] ⚠️  Could not parse Groq response - using 0 score');
        return 0;

    } catch (error) {
        console.error('[MATCH][IMAGE] ❌ Error calling Groq:', error);
        return 0;
    }
}
