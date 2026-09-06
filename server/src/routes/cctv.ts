/**
 * CCTV routes - proxy to the Python YOLO service, plus AI commentary.
 */

import { Router } from 'express';
import { cctvController } from '../controllers/cctv.controller.js';
import {
  aiLimiter,
  asyncHandler,
  cctvScanLimiter,
  authMiddleware,
  requireAdmin,
  validate,
} from '../middleware/index.js';
import { cctvAnalyzeSchema, cctvDescribeSchema, cctvDetectSchema } from '../schemas/index.js';

const router = Router();

/** GET /api/cctv/classes - the class list the dropdown offers */
router.get('/classes', authMiddleware, requireAdmin, asyncHandler(cctvController.listClasses));

/** POST /api/cctv/detect - one frame */
router.post(
  '/detect',
  authMiddleware,
  requireAdmin,
  cctvScanLimiter,
  validate(cctvDetectSchema),
  asyncHandler(cctvController.detect),
);

/** POST /api/cctv/analyze - a batch of frames from uploaded footage */
router.post(
  '/analyze',
  authMiddleware,
  requireAdmin,
  aiLimiter,
  validate(cctvAnalyzeSchema),
  asyncHandler(cctvController.analyze),
);

/** POST /api/cctv/describe - name and describe a detection */
router.post(
  '/describe',
  authMiddleware,
  requireAdmin,
  aiLimiter,
  validate(cctvDescribeSchema),
  asyncHandler(cctvController.describe),
);

export default router;
