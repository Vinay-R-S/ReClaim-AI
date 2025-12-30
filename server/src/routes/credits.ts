/**
 * Credits API Routes - User credit balance management
 */

import { Router, Request, Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { collections, auth } from '../utils/firebase-admin.js';

const router = Router();

const DEFAULT_CREDITS = 10;

/**
 * GET /api/credits/:userId
 * Get user's credit balance (creates default if not exists)
 */
router.get('/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }

        // Try to get existing credits doc
        const creditsDoc = await collections.credits.doc(userId).get();

        if (creditsDoc.exists) {
            const data = creditsDoc.data();
            return res.json({
                userId,
                email: data?.email || '',
                credits: data?.credits || 0,
            });
        }

        // Create default credits for new user
        let userEmail = '';
        try {
            const userRecord = await auth.getUser(userId);
            userEmail = userRecord.email || '';
        } catch {
            // User not found in auth, use empty email
        }

        const newCredits = {
            email: userEmail,
            credits: DEFAULT_CREDITS,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        await collections.credits.doc(userId).set(newCredits);

        return res.json({
            userId,
            email: userEmail,
            credits: DEFAULT_CREDITS,
        });
    } catch (error) {
        console.error('Get credits error:', error);
        return res.status(500).json({ error: 'Failed to get credits' });
    }
});

/**
 * PUT /api/credits/:userId
 * Add credits to user balance
 */
router.put('/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        const { amount, reason } = req.body as { amount: number; reason?: string };

        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }

        if (typeof amount !== 'number') {
            return res.status(400).json({ error: 'Amount must be a number' });
        }

        // Get current credits (or create default)
        const creditsDoc = await collections.credits.doc(userId).get();

        let currentCredits = DEFAULT_CREDITS;
        let userEmail = '';

        if (creditsDoc.exists) {
            const data = creditsDoc.data();
            currentCredits = data?.credits || 0;
            userEmail = data?.email || '';
        } else {
            // Get email from auth
            try {
                const userRecord = await auth.getUser(userId);
                userEmail = userRecord.email || '';
            } catch {
                // User not found in auth
            }
        }

        const newCredits = currentCredits + amount;

        await collections.credits.doc(userId).set({
            email: userEmail,
            credits: newCredits,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Log transaction
        await collections.creditTransactions.add({
            userId,
            email: userEmail,
            amount,
            reason: reason || 'Manual update',
            balanceAfter: newCredits,
            createdAt: FieldValue.serverTimestamp(),
        });

        console.log(`Credits updated for ${userId}: ${amount > 0 ? '+' : ''}${amount}, new balance: ${newCredits}`);

        return res.json({
            userId,
            email: userEmail,
            credits: newCredits,
            added: amount,
        });
    } catch (error) {
        console.error('Update credits error:', error);
        return res.status(500).json({ error: 'Failed to update credits' });
    }
});

export default router;
