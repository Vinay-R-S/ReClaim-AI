/**
 * Role-Based Access Control Middleware
 *
 * All of these run AFTER `authMiddleware`, which has already resolved the
 * caller's role and status from Firestore, so none of them read Firestore
 * again.
 */

import { Response, NextFunction } from 'express';
import { AuthRequest, AuthUser } from './auth.middleware.js';

function requireAuthenticated(req: AuthRequest, res: Response): AuthUser | null {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return req.user;
}

/**
 * A Firebase account with no `users/{uid}` document cannot be role-checked or
 * blocked, so every guard here refuses it rather than defaulting it to an
 * active user. This keeps the 404 the previous implementation returned, and
 * covers a profile deleted out of band.
 */
function rejectIncomplete(user: AuthUser, res: Response): boolean {
  if (!user.profileExists) {
    res.status(404).json({ error: 'User not found' });
    return true;
  }

  if (user.status === 'blocked') {
    res.status(403).json({
      error: 'Account blocked',
      message: 'Your account has been blocked due to policy violations.',
    });
    return true;
  }

  return false;
}

/**
 * Require specific role(s) to access a route
 * Must be used AFTER authMiddleware
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const user = requireAuthenticated(req, res);
    if (!user) return;
    if (rejectIncomplete(user, res)) return;

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to access this resource.',
      });
      return;
    }

    next();
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
export function requireActiveUser(req: AuthRequest, res: Response, next: NextFunction): void {
  const user = requireAuthenticated(req, res);
  if (!user) return;
  if (rejectIncomplete(user, res)) return;

  next();
}

/**
 * Check if request user owns the resource
 * Useful for user-specific resource access
 */
export function requireOwnership(getUserIdFromReq: (req: AuthRequest) => string | undefined) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const user = requireAuthenticated(req, res);
    if (!user) return;
    if (rejectIncomplete(user, res)) return;

    const resourceUserId = getUserIdFromReq(req);

    if (!resourceUserId) {
      res.status(400).json({ error: 'Resource user ID not found' });
      return;
    }

    // Admins can access any resource
    if (user.role === 'admin') {
      next();
      return;
    }

    // Regular users can only access their own resources
    if (user.uid !== resourceUserId) {
      res.status(403).json({
        error: 'Access denied',
        message: 'You can only access your own resources.',
      });
      return;
    }

    next();
  };
}

/**
 * Ownership of a resource whose owner is only known after a database read,
 * such as an item's `reportedBy`. Admins pass regardless.
 */
export function assertOwnerOrAdmin(
  user: AuthUser | undefined,
  ownerId: string | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(ownerId) && user.uid === ownerId;
}
