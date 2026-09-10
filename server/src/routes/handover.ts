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
  requireActiveUser,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
} from '../middleware/index.js';
import {
  handoverConfirmSchema,
  handoverReissueSchema,
  handoverVerifySchema,
  matchIdParamsSchema,
  userIdParamsSchema,
} from '../schemas/index.js';

const router = Router();

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

/**
 * POST /confirm - the owner confirms they have the item.
 *
 * The second half of two-party confirmation. Authenticated, and the controller
 * checks that the caller is the person who reported the lost item: the finder
 * already holds the code, so letting them confirm as well would close the
 * handover with one party's say-so, which is what two-party exists to prevent.
 */
router.post(
  '/confirm',
  authMiddleware,
  // Blocked accounts and deleted profiles are refused here, as they are on
  // every other authenticated route on this router. Without it a user banned
  // for handover fraud kept the ability to close handovers and collect the
  // credits for them.
  requireActiveUser,
  handoverVerifyLimiter,
  validate(handoverConfirmSchema),
  asyncHandler(handoverController.confirm),
);

/**
 * GET /qr/:matchId - a short-lived token for the owner to show the finder.
 *
 * Rate limited like verification, because it mints a credential.
 */
router.get(
  '/qr/:matchId',
  authMiddleware,
  requireActiveUser,
  handoverVerifyLimiter,
  validateParams(matchIdParamsSchema),
  asyncHandler(handoverController.qr),
);

/** GET /timeline/:matchId - admin: every transition this handover has made */
router.get(
  '/timeline/:matchId',
  authMiddleware,
  requireAdmin,
  validateParams(matchIdParamsSchema),
  asyncHandler(handoverController.timeline),
);

/** GET /status/:matchId - public: what state the session is in */
router.get(
  '/status/:matchId',
  handoverStatusLimiter,
  validateParams(matchIdParamsSchema),
  asyncHandler(handoverController.status),
);

/** GET /sessions - admin: the sessions that have not completed */
router.get('/sessions', authMiddleware, requireAdmin, asyncHandler(handoverController.sessions));

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
