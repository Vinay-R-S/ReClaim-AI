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
            // Successful claim - award credits
            const finderId = item.reportedBy;
            await awardMatchCredits(finderId, claimUserId, itemId);

            // Update item status
            await collections.items.doc(itemId).update({
                status: 'Claimed',
                verifiedBy: adminId,
                verifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Get user email for notification
            const userDoc = await collections.users.doc(claimUserId).get();
            if (userDoc.exists) {
                const userData = userDoc.data()!;
                await sendClaimConfirmation(
                    userData.email,
                    item.name,
                    item.location
                );
            }

            return res.json({
                success: true,
                message: 'Claim verified. Credits awarded to both parties.',
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
