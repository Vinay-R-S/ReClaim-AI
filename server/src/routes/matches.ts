/**
 * Match routes.
 *
 * Wiring only: path, middleware, controller.
 */

import { Router } from 'express';
import { matchController } from '../controllers/match.controller.js';
import {
  asyncHandler,
  authMiddleware,
  requireActiveUser,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
} from '../middleware/index.js';
import {
  itemIdParamsSchema,
  matchClaimSchema,
  matchSearchSchema,
  matchVerifySchema,
  userIdParamsSchema,
} from '../schemas/index.js';

const router = Router();

/** POST /api/matches/search - score an item against the other side */
router.post(
  '/search',
  authMiddleware,
  requireActiveUser,
  validate(matchSearchSchema),
  asyncHandler(matchController.search),
);

/** POST /api/matches/claim - a user claims a found item is theirs */
router.post(
  '/claim',
  authMiddleware,
  requireActiveUser,
  validate(matchClaimSchema),
  asyncHandler(matchController.claim),
);

/** POST /api/matches/verify - admin: accept or reject a claim */
router.post(
  '/verify',
  authMiddleware,
  requireAdmin,
  validate(matchVerifySchema),
  asyncHandler(matchController.verify),
);

/** GET /api/matches - admin: live matches */
router.get('/', authMiddleware, requireAdmin, asyncHandler(matchController.list));

/** GET /api/matches/all - admin: live and archived, for the dashboard graphs */
router.get('/all', authMiddleware, requireAdmin, asyncHandler(matchController.listAll));

/** GET /api/matches/item/:itemId - admin: every match an item takes part in */
router.get(
  '/item/:itemId',
  authMiddleware,
  requireAdmin,
  validateParams(itemIdParamsSchema),
  asyncHandler(matchController.listForItem),
);

/** GET /api/matches/user/:userId - a user's open lost reports, scored */
router.get(
  '/user/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(matchController.listForUser),
);

export default router;
