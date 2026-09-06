/**
 * Match routes.
 *
 * Wiring only: path, middleware, controller.
 */

import { Router } from 'express';
import { matchController } from '../controllers/match.controller.js';
import { asyncHandler, authMiddleware, requireAdmin, validate } from '../middleware/index.js';
import { matchVerifySchema } from '../schemas/index.js';

const router = Router();

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

export default router;
