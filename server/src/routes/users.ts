/**
 * User Routes - administration of user documents
 *
 * `status` is server owned: the Firestore rules deny it to every client, so
 * blocking and unblocking goes through here instead of a direct write from the
 * admin console (SEC-17).
 */

import { Router, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import {
  asyncHandler,
  authMiddleware,
  AuthRequest,
  requireAdmin,
  validate,
  validateParams,
} from '../middleware/index.js';
import { userIdParamsSchema, userStatusUpdateSchema } from '../schemas/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('users');

const router = Router();

/**
 * PUT /api/users/:userId/status
 * Block or unblock a user
 */
router.put(
  '/:userId/status',
  authMiddleware,
  requireAdmin,
  validateParams(userIdParamsSchema),
  validate(userStatusUpdateSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const { status } = req.body as { status: 'active' | 'blocked' };

    if (userId === req.user!.uid) {
      return res.status(400).json({ error: 'You cannot change your own status' });
    }

    const userDoc = await collections.users.doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    await collections.users.doc(userId).update({
      status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    log.info('User status changed', { targetUserId: userId, status });

    return res.json({ success: true, userId, status });
  }),
);

export default router;
