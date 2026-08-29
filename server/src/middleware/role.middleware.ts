/**
 * Role-Based Access Control Middleware
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware.js';
import { collections } from '../utils/firebase-admin.js';
import { createLogger } from '../utils/logger.js';
import { AppError } from './errorHandler.middleware.js';

const log = createLogger('role');

/**
 * Require specific role(s) to access a route
 * Must be used AFTER authMiddleware
 */
export function requireRole(...allowedRoles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      // Fetch fresh user data from Firestore to get current role/status
      const userDoc = await collections.users.doc(req.user.uid).get();

      if (!userDoc.exists) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const userData = userDoc.data()!;

      // Check if user is blocked
      if (userData.status === 'blocked') {
        res.status(403).json({
          error: 'Account blocked',
          message: 'Your account has been blocked due to policy violations.',
        });
        return;
      }

      // Check role
      const userRole = userData.role || 'user';
      if (!allowedRoles.includes(userRole)) {
        res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to access this resource.',
        });
        return;
      }

      // Attach role to request for downstream use
      req.user.role = userRole;
      next();
    } catch (error) {
      log.error('Role check failed', { error });
      next(new AppError('Authorization check failed', 500));
    }
  };
}

/**
 * Require admin role
 */
export const requireAdmin = requireRole('admin');

/**
 * Require user to be active (not blocked)
 * Must be used AFTER authMiddleware
 */
export async function requireActiveUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userDoc = await collections.users.doc(req.user.uid).get();

    if (!userDoc.exists) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userData = userDoc.data()!;

    if (userData.status === 'blocked') {
      res.status(403).json({
        error: 'Account blocked',
        message: 'Your account has been blocked due to policy violations.',
      });
      return;
    }

    next();
  } catch (error) {
    log.error('Active user check failed', { error });
    next(new AppError('User status check failed', 500));
  }
}

/**
 * Check if request user owns the resource
 * Useful for user-specific resource access
 */
export function requireOwnership(getUserIdFromReq: (req: AuthRequest) => string | undefined) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const resourceUserId = getUserIdFromReq(req);

    if (!resourceUserId) {
      res.status(400).json({ error: 'Resource user ID not found' });
      return;
    }

    // Admins can access any resource
    if (req.user.role === 'admin') {
      next();
      return;
    }

    // Regular users can only access their own resources
    if (req.user.uid !== resourceUserId) {
      res.status(403).json({
        error: 'Access denied',
        message: 'You can only access your own resources.',
      });
      return;
    }

    next();
  };
}
