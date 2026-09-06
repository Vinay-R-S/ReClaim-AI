/**
 * Auth routes - profile bootstrap and login notifications.
 */

import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { asyncHandler, authMiddleware, requireActiveUser, validate } from '../middleware/index.js';
import { loginNotificationSchema, profileBootstrapSchema } from '../schemas/index.js';

const router = Router();

/**
 * POST /api/auth/profile
 *
 * Runs on `authMiddleware` alone, deliberately: the whole point is that the
 * profile may not exist yet, so the guards that require one cannot apply. A
 * blocked account is still refused.
 */
router.post(
  '/profile',
  authMiddleware,
  validate(profileBootstrapSchema),
  asyncHandler(authController.bootstrapProfile),
);

/** POST /api/auth/login-notification */
router.post(
  '/login-notification',
  authMiddleware,
  requireActiveUser,
  validate(loginNotificationSchema),
  asyncHandler(authController.loginNotification),
);

export default router;
