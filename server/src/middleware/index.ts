/**
 * Middleware barrel export
 */

export { authMiddleware, optionalAuthMiddleware, type AuthRequest } from './auth.middleware.js';
export { authLimiter, apiLimiter, resetLimiter, itemCreateLimiter, testingApiLimiter } from './rateLimit.middleware.js';
export {
    validate,
    validateQuery,
    validateParams,
    signupSchema,
    loginSchema,
    itemInputSchema,
    itemUpdateSchema,
    userIdSchema,
    sanitizeString,
    sanitizeObject
} from './validation.middleware.js';
export { requireRole, requireAdmin, requireActiveUser, requireOwnership } from './role.middleware.js';
export { errorHandler, notFoundHandler, asyncHandler, AppError, logSecurityEvent } from './errorHandler.middleware.js';
