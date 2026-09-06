/**
 * Statistics routes.
 */

import { Router } from 'express';
import { statsController } from '../controllers/stats.controller.js';
import { asyncHandler, authMiddleware, requireAdmin } from '../middleware/index.js';

const router = Router();

/** GET /api/stats/dashboard - admin: everything the dashboard draws, in one read */
router.get('/dashboard', authMiddleware, requireAdmin, asyncHandler(statsController.dashboard));

export default router;
