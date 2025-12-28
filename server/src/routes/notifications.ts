/**
 * Notifications API Routes - Email and push notifications
 */

import { Router, Request, Response } from 'express';
import {
    sendMatchNotification,
    sendClaimConfirmation,
    sendCreditsNotification,
    isEmailConfigured
} from '../services/email.js';
import { getUserCredits, getCreditHistory } from '../services/credits.js';

const router = Router();

/**
 * GET /api/notifications/status
 * Check notification services status
 */
router.get('/status', async (req: Request, res: Response) => {
    return res.json({
        email: isEmailConfigured(),
        push: false, // Not implemented yet
    });
});

/**
 * POST /api/notifications/send-match
 * Send match notification email
 */
router.post('/send-match', async (req: Request, res: Response) => {
    try {
        const { email, itemName, matchScore, collectionPoint } = req.body;

        if (!email || !itemName) {
            return res.status(400).json({ error: 'Email and item name required' });
        }

        const success = await sendMatchNotification(
            email,
            itemName,
            matchScore || 80,
            collectionPoint
        );

        return res.json({ success });
    } catch (error) {
        console.error('Send match notification error:', error);
        return res.status(500).json({ error: 'Failed to send notification' });
    }
});

/**
 * POST /api/notifications/send-claim
 * Send claim confirmation email
 */
router.post('/send-claim', async (req: Request, res: Response) => {
    try {
        const { email, itemName, collectionPoint } = req.body;

        if (!email || !itemName || !collectionPoint) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const success = await sendClaimConfirmation(email, itemName, collectionPoint);

        return res.json({ success });
    } catch (error) {
        console.error('Send claim notification error:', error);
        return res.status(500).json({ error: 'Failed to send notification' });
    }
});

/**
 * GET /api/notifications/credits/:userId
 * Get user credits and history
 */
router.get('/credits/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        const credits = await getUserCredits(userId);
        const history = await getCreditHistory(userId);

        return res.json({ credits, history });
    } catch (error) {
        console.error('Get credits error:', error);
        return res.status(500).json({ error: 'Failed to get credits' });
    }
});

export default router;
