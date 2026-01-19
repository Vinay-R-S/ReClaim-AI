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
 * Get user's credit balance from users collection
 */
router.get('/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }

        // Get credits from users collection
        const userDoc = await collections.users.doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();

        return res.json({
            userId,
            email: userData?.email || '',
            credits: userData?.credits || 0,
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

/**
 * POST /api/credits/signup-bonus
 * Award signup bonus to new user (already handled in signup - this just logs transaction)
 */
router.post('/signup-bonus', async (req: Request, res: Response) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'userId required' });
        }

        // Check if transaction already exists
        const existingTx = await collections.creditTransactions
            .where('userId', '==', userId)
            .where('reason', '==', 'signup_bonus')
            .limit(1)
            .get();

        if (!existingTx.empty) {
            return res.json({ success: true, message: 'Bonus already awarded' });
        }

        // Create transaction record
        await collections.creditTransactions.add({
            userId,
            amount: 10,
            reason: 'signup_bonus',
            createdAt: FieldValue.serverTimestamp(),
        });

        console.log(`Signup bonus transaction logged for ${userId}`);
        return res.json({ success: true });
    } catch (error) {
        console.error('Signup bonus error:', error);
        return res.status(500).json({ error: 'Failed to award signup bonus' });
    }
});

/**
 * GET /api/credits/history/:userId
 * Get credit transaction history
 */
router.get('/history/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        const snapshot = await collections.creditTransactions
            .where('userId', '==', userId)
            .limit(50)
            .get();

        const history = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        // Sort by createdAt descending
        history.sort((a: any, b: any) => {
            const dateA = a.createdAt?.toDate?.() || new Date(0);
            const dateB = b.createdAt?.toDate?.() || new Date(0);
            return dateB.getTime() - dateA.getTime();
        });

        return res.json({ history });
    } catch (error) {
        console.error('Get credit history error:', error);
        return res.status(500).json({ error: 'Failed to get credit history' });
    }
});

export default router;
