import { Router, Request, Response } from 'express';
import {
  initiateHandover,
  verifyHandoverCode,
  getHandoverStatus,
} from '../services/handover.service.js';
import { collections } from '../utils/firebase-admin.js';
import { asyncHandler } from '../middleware/index.js';

const router = Router();

/**
 * POST /api/handover/initiate
 * Initiate handover process (sending emails)
 * Usually called by admin verification, but exposed for flexibility
 */
router.post(
  '/initiate',
  asyncHandler(async (req: Request, res: Response) => {
    const { matchId, lostItemId, foundItemId } = req.body;

    if (!matchId || !lostItemId || !foundItemId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await initiateHandover(matchId, lostItemId, foundItemId);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    return res.json(result);
  }),
);

/**
 * POST /api/handover/verify
 * Public endpoint for found person to verify code
 */
router.post(
  '/verify',
  asyncHandler(async (req: Request, res: Response) => {
    const { matchId, code } = req.body;

    if (!matchId || !code) {
      return res.status(400).json({ error: 'Missing matchId or code' });
    }

    const result = await verifyHandoverCode(matchId, code);

    // If explicitly failed (e.g. invalid code), we might still return 200 with success: false
    // to handle UI gracefully (e.g. showing "2 attempts left")
    return res.json(result);
  }),
);

/**
 * GET /api/handover/status/:matchId
 * Check status of a handover session
 */
router.get(
  '/status/:matchId',
  asyncHandler(async (req: Request, res: Response) => {
    const { matchId } = req.params;
    const status = await getHandoverStatus(matchId);

    if (!status) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.json(status);
  }),
);

/**
 * GET /api/handover/history
 * Admin: Get all completed handovers
 */
router.get(
  '/history',
  asyncHandler(async (req: Request, res: Response) => {
    const snapshot = await collections.handovers.orderBy('handoverTime', 'desc').get();

    const history = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({ history });
  }),
);

export default router;
