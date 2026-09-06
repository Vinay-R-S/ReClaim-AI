/**
 * Handover routes.
 *
 * One router for the whole domain. There used to be two, `handover.ts` and
 * `handovers.ts`, mounted at `/api/handover` and `/api/handovers`, with no rule
 * about which endpoint belonged to which (defect ARCH-04). Both mount points
 * are kept so no client call has to change; the paths below are what separates
 * them.
 */

import { Router } from 'express';
import { handoverController } from '../controllers/handover.controller.js';
import {
  asyncHandler,
  authMiddleware,
  handoverStatusLimiter,
  handoverVerifyLimiter,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
} from '../middleware/index.js';
import {
  handoverInitiateSchema,
  handoverReissueSchema,
  handoverVerifySchema,
  matchIdParamsSchema,
  userIdParamsSchema,
} from '../schemas/index.js';

const router = Router();

/** POST /initiate - admin: open a handover session and send the code */
router.post(
  '/initiate',
  authMiddleware,
  requireAdmin,
  validate(handoverInitiateSchema),
  asyncHandler(handoverController.initiate),
);

/**
 * POST /reissue - admin: a fresh code for a session blocked by failed attempts.
 * A blocked session cannot be reopened any other way, and every re-issue is
 * recorded in the handover audit trail.
 */
router.post(
  '/reissue',
  authMiddleware,
  requireAdmin,
  validate(handoverReissueSchema),
  asyncHandler(handoverController.reissue),
);

/** POST /verify - public: the finder enters the code */
router.post(
  '/verify',
  handoverVerifyLimiter,
  validate(handoverVerifySchema),
  asyncHandler(handoverController.verify),
);

/** GET /status/:matchId - public: what state the session is in */
router.get(
  '/status/:matchId',
  handoverStatusLimiter,
  validateParams(matchIdParamsSchema),
  asyncHandler(handoverController.status),
);

/** GET /history - admin: every completed handover */
router.get('/history', authMiddleware, requireAdmin, asyncHandler(handoverController.history));

/** GET /user/:userId - the handovers one person took part in */
router.get(
  '/user/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(handoverController.listForUser),
);

export default router;
