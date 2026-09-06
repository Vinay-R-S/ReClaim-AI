/**
 * Verification routes - item ownership verification flow.
 */

import { Router } from 'express';
import { verificationController } from '../controllers/verification.controller.js';
import {
  asyncHandler,
  authMiddleware,
  requireActiveUser,
  requireAdmin,
  validate,
  validateParams,
} from '../middleware/index.js';
import {
  idParamsSchema,
  itemIdParamsSchema,
  verificationAnswerSchema,
  verificationStartSchema,
} from '../schemas/index.js';

const router = Router();

/** POST /api/verification/start - open a session for a claim */
router.post(
  '/start',
  authMiddleware,
  requireActiveUser,
  validate(verificationStartSchema),
  asyncHandler(verificationController.start),
);

/** GET /api/verification/item/:itemId - admin: every session for an item */
router.get(
  '/item/:itemId',
  authMiddleware,
  requireAdmin,
  validateParams(itemIdParamsSchema),
  asyncHandler(verificationController.listForItem),
);

/** POST /api/verification/:id/answer */
router.post(
  '/:id/answer',
  authMiddleware,
  requireActiveUser,
  validateParams(idParamsSchema),
  validate(verificationAnswerSchema),
  asyncHandler(verificationController.answer),
);

/** GET /api/verification/:id */
router.get(
  '/:id',
  authMiddleware,
  requireActiveUser,
  validateParams(idParamsSchema),
  asyncHandler(verificationController.getById),
);

export default router;
