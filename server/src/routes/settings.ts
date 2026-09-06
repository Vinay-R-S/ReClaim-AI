/**
 * Settings routes.
 */

import { Router } from 'express';
import { settingsController } from '../controllers/settings.controller.js';
import {
  asyncHandler,
  authMiddleware,
  requireActiveUser,
  requireAdmin,
  validate,
} from '../middleware/index.js';
import { profilePictureSchema, settingsUpdateSchema } from '../schemas/index.js';

const router = Router();

/** GET /api/settings/mode - public: the welcome page decides from this */
router.get('/mode', asyncHandler(settingsController.getMode));

/** POST /api/settings/visit - public: the visitor counter */
router.post('/visit', asyncHandler(settingsController.recordVisit));

/** GET /api/settings/analytics - admin */
router.get(
  '/analytics',
  authMiddleware,
  requireAdmin,
  asyncHandler(settingsController.getAnalytics),
);

/** POST /api/settings/profile-picture - the caller's own avatar */
router.post(
  '/profile-picture',
  authMiddleware,
  requireActiveUser,
  validate(profilePictureSchema),
  asyncHandler(settingsController.setProfilePicture),
);

/** GET /api/settings */
router.get('/', authMiddleware, asyncHandler(settingsController.getSystem));

/** PUT /api/settings - admin */
router.put(
  '/',
  authMiddleware,
  requireAdmin,
  validate(settingsUpdateSchema),
  asyncHandler(settingsController.updateSystem),
);

export default router;
