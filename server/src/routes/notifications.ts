/**
 * Notifications API Routes - Email and push notifications
 */

import { Router, Request, Response } from 'express';
import {
  sendMatchNotification,
  sendClaimConfirmation,
  sendCreditsNotification,
  isEmailConfigured,
} from '../services/email.js';
import { getUserCredits, getCreditHistory } from '../services/credits.js';
import { asyncHandler, authMiddleware, requireAdmin } from '../middleware/index.js';

const router = Router();

/**
 * GET /api/notifications/status
 * Check notification services status
 */
router.get(
  '/status',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    return res.json({
      email: isEmailConfigured(),
      push: false, // Not implemented yet
    });
  }),
);

/**
 * POST /api/notifications/send-match
 * Send match notification email
 */
router.post(
  '/send-match',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { email, itemName, matchScore, collectionPoint } = req.body;

    if (!email || !itemName) {
      return res.status(400).json({ error: 'Email and item name required' });
    }

    const success = await sendMatchNotification(email, itemName, matchScore || 80, collectionPoint);

    return res.json({ success });
  }),
);

/**
 * POST /api/notifications/send-claim
 * Send claim confirmation email
 */
router.post(
  '/send-claim',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { email, itemName, collectionPoint } = req.body;

    if (!email || !itemName || !collectionPoint) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const success = await sendClaimConfirmation(email, itemName, collectionPoint);

    return res.json({ success });
  }),
);

/**
 * GET /api/notifications/credits/:userId
 * Get user credits and history
 */
router.get(
  '/credits/:userId',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const credits = await getUserCredits(userId);
    const history = await getCreditHistory(userId);

    return res.json({ credits, history });
  }),
);

export default router;
