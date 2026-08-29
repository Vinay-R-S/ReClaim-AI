/**
 * Authentication Middleware - Verify Firebase ID tokens
 *
 * Firebase ID tokens have a 1-hour expiry (managed by Firebase).
 * Client should refresh tokens automatically using Firebase SDK.
 *
 * Role and status come from the Firestore `users` document, not from a custom
 * claim: the app never sets custom claims, so anything reading `decodedToken.role`
 * silently saw `undefined` and the admin bypass in `requireOwnership` never
 * fired (SEC-19). The cost is one read per authenticated request; phase 16
 * adds caching.
 */

import { Request, Response, NextFunction } from 'express';
import { auth, collections } from '../utils/firebase-admin.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth');

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'blocked';

export interface AuthUser {
  uid: string;
  email?: string;
  role: UserRole;
  status: UserStatus;
  /** False when no `users/{uid}` document exists yet, for example mid-signup. */
  profileExists: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * Resolve role and status from Firestore. A missing profile is not an error
 * here: signup creates the auth account before the document, and the routes
 * that need a profile check `profileExists` themselves.
 */
async function resolveUser(uid: string, email?: string): Promise<AuthUser> {
  const userDoc = await collections.users.doc(uid).get();

  if (!userDoc.exists) {
    return { uid, email, role: 'user', status: 'active', profileExists: false };
  }

  const data = userDoc.data() ?? {};
  return {
    uid,
    email,
    role: data.role === 'admin' ? 'admin' : 'user',
    status: data.status === 'blocked' ? 'blocked' : 'active',
    profileExists: true,
  };
}

/**
 * Verify Firebase ID token from Authorization header
 * Expected format: Authorization: Bearer <idToken>
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized: No token provided' });
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Verify the ID token with Firebase Admin SDK
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (error: unknown) {
      handleTokenError(error, res);
      return;
    }

    // Kept out of the token try/catch on purpose: a Firestore outage is a 500,
    // not a bad token, and answering 401 would sign every user out.
    req.user = await resolveUser(decodedToken.uid, decodedToken.email);

    next();
  } catch (error: unknown) {
    log.error('Failed to resolve the authenticated user', { error });
    res.status(500).json({ error: 'Authentication is temporarily unavailable' });
  }
}

function handleTokenError(error: unknown, res: Response): void {
  const code = (error as { code?: string }).code;
  log.warn('Token verification failed', { errorCode: code });

  // Handle specific Firebase errors
  if (code === 'auth/id-token-expired') {
    res.status(401).json({ error: 'Token expired. Please sign in again.' });
    return;
  }

  if (code === 'auth/id-token-revoked') {
    res.status(401).json({ error: 'Token revoked. Please sign in again.' });
    return;
  }

  res.status(401).json({ error: 'Unauthorized: Invalid token' });
}

/**
 * Optional auth - attaches user if token exists, but doesn't require it
 */
export async function optionalAuthMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader?.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await auth.verifyIdToken(idToken);
      req.user = await resolveUser(decodedToken.uid, decodedToken.email);
    }

    next();
  } catch {
    // Token invalid, but we continue without user
    next();
  }
}
