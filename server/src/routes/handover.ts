import { Router, Request, Response } from 'express';
import {
    initiateHandover,
    verifyHandoverCode,
    getHandoverStatus
} from '../services/handover.service.js';
import { collections } from '../utils/firebase-admin.js';

const router = Router();

/**
 * POST /api/handover/initiate
 * Initiate handover process (sending emails)
 * Usually called by admin verification, but exposed for flexibility
 */
router.post('/initiate', async (req: Request, res: Response) => {
    try {
        const { matchId, lostItemId, foundItemId } = req.body;

        if (!matchId || !lostItemId || !foundItemId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await initiateHandover(matchId, lostItemId, foundItemId);

        if (!result.success) {
            return res.status(400).json({ error: result.message });
        }

        return res.json(result);
    } catch (error) {
        console.error('Initiate handover error:', error);
        return res.status(500).json({ error: 'Failed' });
    }
});

/**
 * POST /api/handover/verify
 * Public endpoint for found person to verify code
 */
router.post('/verify', async (req: Request, res: Response) => {
    try {
        const { matchId, code } = req.body;

        if (!matchId || !code) {
            return res.status(400).json({ error: 'Missing matchId or code' });
        }

        const result = await verifyHandoverCode(matchId, code);

        // If explicitly failed (e.g. invalid code), we might still return 200 with success: false
        // to handle UI gracefully (e.g. showing "2 attempts left")
        return res.json(result);
    } catch (error) {
        console.error('Verify handover error:', error);
        return res.status(500).json({ error: 'Failed' });
    }
});

/**
 * GET /api/handover/status/:matchId
 * Check status of a handover session
 */
router.get('/status/:matchId', async (req: Request, res: Response) => {
    try {
        const { matchId } = req.params;
        const status = await getHandoverStatus(matchId);

        if (!status) {
            return res.status(404).json({ error: 'Not found' });
        }

        return res.json(status);
    } catch (error) {
        console.error('Get handover status error:', error);
        return res.status(500).json({ error: 'Failed' });
    }
});

/**
 * GET /api/handover/history
 * Admin: Get all completed handovers
 */
router.get('/history', async (req: Request, res: Response) => {
    try {
        const snapshot = await collections.handovers
            .orderBy('handoverTime', 'desc')
            .get();

        const history = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.json({ history });
    } catch (error) {
        console.error('Get history error:', error);
        return res.status(500).json({ error: 'Failed' });
    }
});

export default router;
