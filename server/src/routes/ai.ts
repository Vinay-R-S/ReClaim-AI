/**
 * AI routes - item analysis for the report and add-item flows.
 *
 * These exist so that no LLM key ever reaches the browser (defect SEC-16).
 */

import { Router } from 'express';
import { aiController } from '../controllers/ai.controller.js';
import {
  aiLimiter,
  asyncHandler,
  authMiddleware,
  requireActiveUser,
  validate,
} from '../middleware/index.js';
import { analyzeImageSchema, enhanceDescriptionSchema } from '../schemas/index.js';

const router = Router();

/** GET /api/ai/status - whether the analyse step is worth offering */
router.get('/status', authMiddleware, requireActiveUser, asyncHandler(aiController.status));

/** POST /api/ai/analyze-image */
router.post(
  '/analyze-image',
  authMiddleware,
  requireActiveUser,
  aiLimiter,
  validate(analyzeImageSchema),
  asyncHandler(aiController.analyzeImage),
);

/** POST /api/ai/enhance-description */
router.post(
  '/enhance-description',
  authMiddleware,
  requireActiveUser,
  aiLimiter,
  validate(enhanceDescriptionSchema),
  asyncHandler(aiController.enhanceDescription),
);

export default router;
