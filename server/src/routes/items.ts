/**
 * Item routes.
 *
 * Wiring only: path, middleware, controller. What each endpoint does is in
 * `ItemController` and `ItemService`.
 */

import { Router } from 'express';
import { itemController } from '../controllers/item.controller.js';
import {
  asyncHandler,
  authMiddleware,
  itemCreateLimiter,
  optionalAuthMiddleware,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
  validateQuery,
} from '../middleware/index.js';
import {
  idParamsSchema,
  itemInputSchema,
  itemListQuerySchema,
  itemModerateSchema,
  itemStatusUpdateSchema,
  itemUpdateSchema,
  userIdParamsSchema,
} from '../schemas/index.js';

const router = Router();

/** GET /api/items - browse list, filtered and bounded */
router.get(
  '/',
  optionalAuthMiddleware,
  validateQuery(itemListQuerySchema),
  asyncHandler(itemController.list),
);

/** GET /api/items/user/:userId - a user's own reports */
router.get(
  '/user/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(itemController.listByUser),
);

/** GET /api/items/:id */
router.get(
  '/:id',
  optionalAuthMiddleware,
  validateParams(idParamsSchema),
  asyncHandler(itemController.getById),
);

/** GET /api/items/:id/audit - admin: review decisions on this item */
router.get(
  '/:id/audit',
  authMiddleware,
  requireAdmin,
  validateParams(idParamsSchema),
  asyncHandler(itemController.listAudit),
);

/** POST /api/items - report an item */
router.post(
  '/',
  authMiddleware,
  itemCreateLimiter,
  validate(itemInputSchema),
  asyncHandler(itemController.create),
);

/** POST /api/items/:id/moderate - admin: approve or reject */
router.post(
  '/:id/moderate',
  authMiddleware,
  requireAdmin,
  validateParams(idParamsSchema),
  validate(itemModerateSchema),
  asyncHandler(itemController.moderate),
);

/** POST /api/items/:id/rematch - admin: re-run matching */
router.post(
  '/:id/rematch',
  authMiddleware,
  requireAdmin,
  validateParams(idParamsSchema),
  asyncHandler(itemController.rematch),
);

/** PUT /api/items/:id */
router.put(
  '/:id',
  authMiddleware,
  validateParams(idParamsSchema),
  validate(itemUpdateSchema),
  asyncHandler(itemController.update),
);

/** PUT /api/items/:id/status - admin */
router.put(
  '/:id/status',
  authMiddleware,
  requireAdmin,
  validateParams(idParamsSchema),
  validate(itemStatusUpdateSchema),
  asyncHandler(itemController.updateStatus),
);

/** DELETE /api/items/:id */
router.delete(
  '/:id',
  authMiddleware,
  validateParams(idParamsSchema),
  asyncHandler(itemController.remove),
);

export default router;
