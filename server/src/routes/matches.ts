/**
 * Matches API Routes - Find and manage item matches
 */

import { Router, Request, Response } from 'express';
import { findMatchesForLostItem, findMatchesForFoundItem } from '../services/matching.js';
import { awardMatchCredits, penalizeFalseClaim } from '../services/credits.js';
import { sendMatchNotification, sendClaimConfirmation } from '../services/email.js';
import { collections } from '../utils/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

const router = Router();

/**
 * POST /api/matches/search
 * Search for matches for an item
 */
router.post('/search', async (req: Request, res: Response) => {
    try {
        const { type, name, description, tags, coordinates, date, imageBase64 } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Item name required' });
        }

        const searchParams = {
            name,
            description: description || '',
            tags: tags || [],
            coordinates,
            date: date ? new Date(date) : new Date(),
            imageBase64,
        };

        const matches = type === 'Lost'
            ? await findMatchesForLostItem(searchParams)
            : await findMatchesForFoundItem(searchParams);

        return res.json({ matches });
    } catch (error) {
        console.error('Search matches error:', error);
        return res.status(500).json({ error: 'Failed to search matches' });
    }
});

/**
 * POST /api/matches/claim
 * Claim a match (user claims a found item is theirs)
 */
router.post('/claim', async (req: Request, res: Response) => {
    try {
        const { userId, userEmail, itemId, lostItemId } = req.body;

        if (!userId || !itemId) {
            return res.status(400).json({ error: 'User ID and Item ID required' });
        }

        // Get the found item
        const itemDoc = await collections.items.doc(itemId).get();
        if (!itemDoc.exists) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const item = itemDoc.data()!;

        // Update item status to "Under Verification"
        await collections.items.doc(itemId).update({
            status: 'Matched',
            claimedBy: userId,
            claimedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // If there's a corresponding lost item, update it too
        if (lostItemId) {
            await collections.items.doc(lostItemId).update({
                status: 'Matched',
                matchedItemId: itemId,
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        // Notify via email
        if (userEmail) {
            await sendMatchNotification(
                userEmail,
                item.name,
                85, // Placeholder match score
                item.location
            );
        }

        return res.json({
            success: true,
            message: 'Claim submitted. Please visit the collection point with ID for verification.',
        });
    } catch (error) {
        console.error('Claim error:', error);
        return res.status(500).json({ error: 'Failed to submit claim' });
    }
});

import { initiateHandover } from '../services/handover.service.js';

/**
 * POST /api/matches/verify
 * Admin verifies a claim (marks as successful or false)
 */

router.post('/verify', async (req: Request, res: Response) => {
    try {
        const { itemId, claimUserId, isValid, adminId } = req.body;

        if (!itemId || !claimUserId || isValid === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const itemDoc = await collections.items.doc(itemId).get();
        if (!itemDoc.exists) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const item = itemDoc.data()!;

        if (isValid) {
            // VERIFIED MATCH - Initiate Handover

            // 1. Find or Create Match Record
            let matchId = '';
            // Check if match exists (using item as either lost or found)
            const matchQuery = await collections.matches
                .where('foundItemId', '==', itemId)
                .where('lostItemId', '==', item.matchedItemId || 'unknown') // Try to find by matched item
                .limit(1)
                .get();

            if (!matchQuery.empty) {
                matchId = matchQuery.docs[0].id;
            } else {
                // Try reverse
                const matchQuery2 = await collections.matches
                    .where('lostItemId', '==', itemId)
                    .where('foundItemId', '==', item.matchedItemId || 'unknown')
                    .limit(1)
                    .get();
                if (!matchQuery2.empty) {
                    matchId = matchQuery2.docs[0].id;
                }
            }

            // If still no match ID (e.g. manual claim without match record), create one
            if (!matchId) {
                const newMatch = await collections.matches.add({
                    lostItemId: item.type === 'Lost' ? itemId : (item.matchedItemId || 'unknown'),
                    foundItemId: item.type === 'Found' ? itemId : (item.matchedItemId || 'unknown'),
                    matchScore: 100, // Verified manually
                    status: 'matched',
                    createdAt: FieldValue.serverTimestamp()
                });
                matchId = newMatch.id;
            }

            // 2. Initiate Handover
            // We need both item IDs. 
            const lostItemId = item.type === 'Lost' ? itemId : item.matchedItemId;
            const foundItemId = item.type === 'Found' ? itemId : item.matchedItemId;

            if (!lostItemId || !foundItemId) {
                return res.status(400).json({ error: 'Cannot initiate handover: missing linked item ID' });
            }

            const result = await initiateHandover(matchId, lostItemId, foundItemId);

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            // Update item verification status but keep as Matched/Pending until handover
            await collections.items.doc(itemId).update({
                verificationConfidence: 100,
                verifiedBy: adminId,
                verifiedAt: FieldValue.serverTimestamp(),
            });

            return res.json({
                success: true,
                message: 'Match verified. Handover process initiated and emails sent.',
            });

        } else {
            // False claim - penalize
            await penalizeFalseClaim(claimUserId, itemId);

            // Reset item status back to pending
            await collections.items.doc(itemId).update({
                status: 'Pending',
                claimedBy: FieldValue.delete(),
                claimedAt: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return res.json({
                success: true,
                message: 'Claim rejected. Penalty applied to user.',
            });
        }
    } catch (error) {
        console.error('Verify error:', error);
        return res.status(500).json({ error: 'Failed to verify claim' });
    }
});

/**
 * GET /api/matches
 * Get all match records from matches collection
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const snapshot = await collections.matches
            .orderBy('createdAt', 'desc')
            .get();

        const matches = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.json({ matches });
    } catch (error) {
        console.error('Get matches error:', error);
        return res.status(500).json({ error: 'Failed to get matches' });
    }
});

/**
 * GET /api/matches/all
 * Get all matches including historical (claimed) matches for dashboard graphs
 */
router.get('/all', async (req: Request, res: Response) => {
    try {
        // Get active matches
        const activeSnapshot = await collections.matches
            .orderBy('createdAt', 'desc')
            .get();

        // Get historical matches
        const historySnapshot = await collections.matchHistory
            .orderBy('createdAt', 'desc')
            .get();

        const activeMatches = activeSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            isActive: true,
        }));

        const historicalMatches = historySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            isActive: false,
        }));

        // Combine and return all matches
        const allMatches = [...activeMatches, ...historicalMatches];

        return res.json({ matches: allMatches });
    } catch (error) {
        console.error('Get all matches error:', error);
        return res.status(500).json({ error: 'Failed to get all matches' });
    }
});

/**
 * GET /api/matches/item/:itemId
 * Get all match records for a specific item
 */
router.get('/item/:itemId', async (req: Request, res: Response) => {
    try {
        const { itemId } = req.params;

        // Query for matches where this item is either the lost or found item
        const lostMatches = await collections.matches
            .where('lostItemId', '==', itemId)
            .get();

        const foundMatches = await collections.matches
            .where('foundItemId', '==', itemId)
            .get();

        const matches = [
            ...lostMatches.docs.map(doc => ({ id: doc.id, ...doc.data() })),
            ...foundMatches.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        ];

        return res.json({ matches });
    } catch (error) {
        console.error('Get item matches error:', error);
        return res.status(500).json({ error: 'Failed to get item matches' });
    }
});


/**
 * GET /api/matches/user/:userId
 * Get all matches for a user's items
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        // Get user's lost items
        const lostSnapshot = await collections.items
            .where('reportedBy', '==', userId)
            .where('type', '==', 'Lost')
            .get();

        // Get matches for each
        const allMatches = [];

        for (const doc of lostSnapshot.docs) {
            const item = doc.data();
            const matches = await findMatchesForLostItem({
                name: item.name,
                description: item.description,
                tags: item.tags,
                coordinates: item.coordinates,
                date: item.date.toDate(),
            });

            allMatches.push({
                lostItem: { id: doc.id, ...item },
                matches,
            });
        }

        return res.json({ results: allMatches });
    } catch (error) {
        console.error('Get user matches error:', error);
        return res.status(500).json({ error: 'Failed to get matches' });
    }
});

export default router;
