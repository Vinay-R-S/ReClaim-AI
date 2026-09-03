/**
 * Credits API Routes - user credit balances
 *
 * Every read and write goes through the credits service, so `users/{uid}.credits`
 * plus the `creditTransactions` ledger stay the only store. This route used to
 * write a separate `credits/{uid}` document that nothing ever read (LOG-01).
 */

import { Router, Request, Response } from 'express';
import { collections } from '../utils/firebase-admin.js';
import { adjustCredits, getCreditHistory } from '../services/credits.js';
import {
  asyncHandler,
  authMiddleware,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
} from '../middleware/index.js';
import { creditAdjustmentSchema, userIdParamsSchema } from '../schemas/index.js';
import { AppError } from '../middleware/index.js';

const router = Router();

/**
 * GET /api/credits/:userId
 * Get a user's credit balance
 */
router.get(
  '/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const userDoc = await collections.users.doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      userId,
      email: userDoc.data()?.email || '',
      credits: userDoc.data()?.credits ?? 0,
    });
  }),
);

/**
 * PUT /api/credits/:userId
 * Adjust a user's balance by a delta
 */
router.put(
  '/:userId',
  authMiddleware,
  requireAdmin,
  validateParams(userIdParamsSchema),
  validate(creditAdjustmentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { amount, reason } = req.body as { amount: number; reason?: string };

    const userDoc = await collections.users.doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await adjustCredits(userId, amount, reason);

    if (!result.success) {
      throw new AppError('Failed to adjust credits', 500);
    }

    return res.json({
      userId,
      email: userDoc.data()?.email || '',
      credits: result.newBalance,
      added: amount,
    });
  }),
);

/**
 * GET /api/credits/history/:userId
 * Get credit transaction history
 */
router.get(
  '/history/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(async (req: Request, res: Response) => {
    const history = await getCreditHistory(req.params.userId, 50);
    return res.json({ history });
  }),
);

export default router;
