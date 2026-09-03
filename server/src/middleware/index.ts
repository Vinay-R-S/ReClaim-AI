/**
 * Middleware barrel export
 */

export {
  authMiddleware,
  optionalAuthMiddleware,
  type AuthRequest,
  type AuthUser,
  type UserRole,
} from './auth.middleware.js';
export {
  authLimiter,
  apiLimiter,
  resetLimiter,
  itemCreateLimiter,
  testingApiLimiter,
  handoverVerifyLimiter,
  handoverStatusLimiter,
} from './rateLimit.middleware.js';
export { validate, validateQuery, validateParams } from './validation.middleware.js';
export {
  requireRole,
  requireAdmin,
  requireActiveUser,
  requireOwnership,
  assertOwnerOrAdmin,
} from './role.middleware.js';
export {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
  logSecurityEvent,
} from './errorHandler.middleware.js';
