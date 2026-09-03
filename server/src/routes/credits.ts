/**
 * Credits API Routes - User credit balance management
 */

import { Router, Request, Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { collections, auth } from '../utils/firebase-admin.js';
import { createLogger } from '../utils/logger.js';
import {
  asyncHandler,
  authMiddleware,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
} from '../middleware/index.js';
import { creditAdjustmentSchema, userIdParamsSchema } from '../schemas/index.js';

const log = createLogger('credits');

const router = Router();

const DEFAULT_CREDITS = 10;

/**
 * GET /api/credits/:userId
 * Get user's credit balance from users collection
 */
router.get(
  '/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

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
  }),
);

/**
 * PUT /api/credits/:userId
 * Add credits to user balance
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

    await collections.credits.doc(userId).set(
      {
        email: userEmail,
        credits: newCredits,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Log transaction
    await collections.creditTransactions.add({
      userId,
      email: userEmail,
      amount,
      reason: reason || 'Manual update',
      balanceAfter: newCredits,
      createdAt: FieldValue.serverTimestamp(),
    });

    log.info(
      `Credits updated for ${userId}: ${amount > 0 ? '+' : ''}${amount}, new balance: ${newCredits}`,
    );

    return res.json({
      userId,
      email: userEmail,
      credits: newCredits,
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
    const { userId } = req.params;

    const snapshot = await collections.creditTransactions
      .where('userId', '==', userId)
      .limit(50)
      .get();

    const history = snapshot.docs.map((doc) => ({
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
  }),
);

export default router;
