/**
 * Credit routes.
 *
 * Every read and write goes through the credits service, so `users/{uid}.credits`
 * plus the `creditTransactions` ledger stay the only store. This route used to
 * write a separate `credits/{uid}` document that nothing ever read (LOG-01).
 */

import { Router } from 'express';
import { creditController } from '../controllers/credit.controller.js';
import {
  asyncHandler,
  authMiddleware,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
} from '../middleware/index.js';
import { creditAdjustmentSchema, userIdParamsSchema } from '../schemas/index.js';

const router = Router();

/** GET /api/credits/history/:userId - the ledger behind the balance */
router.get(
  '/history/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(creditController.history),
);

/** GET /api/credits/:userId */
router.get(
  '/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(creditController.getBalance),
);

/** PUT /api/credits/:userId - admin: adjust a balance by a delta */
router.put(
  '/:userId',
  authMiddleware,
  requireAdmin,
  validateParams(userIdParamsSchema),
  validate(creditAdjustmentSchema),
  asyncHandler(creditController.adjust),
);

export default router;
