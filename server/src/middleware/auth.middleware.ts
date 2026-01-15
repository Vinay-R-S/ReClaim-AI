/**
 * Authentication Middleware - Verify Firebase ID tokens
 * 
 * Firebase ID tokens have a 1-hour expiry (managed by Firebase).
 * Client should refresh tokens automatically using Firebase SDK.
 */

import { Request, Response, NextFunction } from 'express';
import { auth } from '../utils/firebase-admin.js';

export interface AuthRequest extends Request {
    user?: {
        uid: string;
        email?: string;
        role?: string;
    };
}

/**
 * Verify Firebase ID token from Authorization header
 * Expected format: Authorization: Bearer <idToken>
 */
export async function authMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Unauthorized: No token provided' });
            return;
        }

        const idToken = authHeader.split('Bearer ')[1];

        // Verify the ID token with Firebase Admin SDK
        const decodedToken = await auth.verifyIdToken(idToken);

        // Attach user info to request
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            role: (decodedToken as any).role || 'user'
        };

        next();
    } catch (error: any) {
        console.error('Auth middleware error:', error.message);

        // Handle specific Firebase errors
        if (error.code === 'auth/id-token-expired') {
            res.status(401).json({ error: 'Token expired. Please sign in again.' });
            return;
        }

        if (error.code === 'auth/id-token-revoked') {
            res.status(401).json({ error: 'Token revoked. Please sign in again.' });
            return;
        }

        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
}

/**
 * Optional auth - attaches user if token exists, but doesn't require it
 */
export async function optionalAuthMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader?.startsWith('Bearer ')) {
            const idToken = authHeader.split('Bearer ')[1];
            const decodedToken = await auth.verifyIdToken(idToken);

            req.user = {
                uid: decodedToken.uid,
                email: decodedToken.email,
                role: (decodedToken as any).role || 'user'
            };
        }

        next();
    } catch (error) {
        // Token invalid, but we continue without user
        next();
    }
}
