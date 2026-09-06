/**
 * Notification routes - email delivery and the credit summary behind it.
 */

import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import {
  asyncHandler,
  authMiddleware,
  requireAdmin,
  validate,
  validateParams,
} from '../middleware/index.js';
import {
  sendClaimNotificationSchema,
  sendMatchNotificationSchema,
  userIdParamsSchema,
} from '../schemas/index.js';

const router = Router();

/** GET /api/notifications/status - admin: which transports are configured */
router.get('/status', authMiddleware, requireAdmin, asyncHandler(notificationController.status));

/** POST /api/notifications/send-match - admin */
router.post(
  '/send-match',
  authMiddleware,
  requireAdmin,
  validate(sendMatchNotificationSchema),
  asyncHandler(notificationController.sendMatch),
);

/** POST /api/notifications/send-claim - admin */
router.post(
  '/send-claim',
  authMiddleware,
  requireAdmin,
  validate(sendClaimNotificationSchema),
  asyncHandler(notificationController.sendClaim),
);

/** GET /api/notifications/credits/:userId - admin */
router.get(
  '/credits/:userId',
  authMiddleware,
  requireAdmin,
  validateParams(userIdParamsSchema),
  asyncHandler(notificationController.credits),
);

export default router;
