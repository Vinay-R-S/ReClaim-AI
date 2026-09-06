/**
 * User routes - administration of user documents.
 */

import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import {
  asyncHandler,
  authMiddleware,
  requireAdmin,
  validate,
  validateParams,
} from '../middleware/index.js';
import { userIdParamsSchema, userStatusUpdateSchema } from '../schemas/index.js';

const router = Router();

/** GET /api/users - admin: a page of accounts, newest first */
router.get('/', authMiddleware, requireAdmin, asyncHandler(userController.list));

/** PUT /api/users/:userId/status - admin: block or unblock an account */
router.put(
  '/:userId/status',
  authMiddleware,
  requireAdmin,
  validateParams(userIdParamsSchema),
  validate(userStatusUpdateSchema),
  asyncHandler(userController.setStatus),
);

export default router;
