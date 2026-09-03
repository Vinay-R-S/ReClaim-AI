/**
 * Auth Routes - Login notifications and authentication-related endpoints
 */

import express from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { sendLoginNotification } from '../services/email.js';
import { collections } from '../utils/firebase-admin.js';
import { stripUndefined } from '../utils/firestore.js';
import { createLogger } from '../utils/logger.js';
import {
  asyncHandler,
  authMiddleware,
  AuthRequest,
  requireActiveUser,
  validate,
} from '../middleware/index.js';
import { loginNotificationSchema, profileBootstrapSchema } from '../schemas/index.js';
import { AppError } from '../middleware/index.js';

const log = createLogger('auth');

const router = express.Router();

const SIGNUP_CREDITS = 10;

interface CreatedProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: 'user';
  status: 'active';
  credits: number;
}

/**
 * Create the profile document, or return null if one already exists
 */
async function createProfile(
  userRef: FirebaseFirestore.DocumentReference,
  uid: string,
  email: string | null | undefined,
  displayName: string | undefined,
  photoURL: string | undefined,
): Promise<CreatedProfile | null> {
  const profile: CreatedProfile = {
    uid,
    email: email ?? null,
    displayName: displayName ?? null,
    photoURL: photoURL ?? null,
    role: 'user',
    status: 'active',
    credits: SIGNUP_CREDITS,
  };

  try {
    await userRef.create({
      ...profile,
      lostItemsCount: 0,
      foundItemsCount: 0,
      totalItemsCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      lastLoginAt: FieldValue.serverTimestamp(),
    });
    return profile;
  } catch (error) {
    // ALREADY_EXISTS. Anything else is a real failure and must surface.
    if ((error as { code?: number }).code === 6) return null;
    throw error;
  }
}

/**
 * POST /api/auth/profile
 * Create the caller's `users/{uid}` document on first sign-in, or refresh
 * `lastLoginAt` if it already exists, and return the profile.
 *
 * The browser used to write this document itself, including `role`, `status`
 * and `credits`, which meant anyone could self-assign `role: "admin"` or an
 * arbitrary balance (SEC-17). Those fields are decided here and denied to the
 * client by the Firestore rules.
 *
 * This route deliberately runs on `authMiddleware` alone: the whole point is
 * that the profile may not exist yet, so the guards that require one cannot
 * apply. A blocked user is still refused.
 */
router.post(
  '/profile',
  authMiddleware,
  validate(profileBootstrapSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const { uid, email } = req.user!;
    const userRef = collections.users.doc(uid);

    // Sign-in fires this from two places at once (the auth state listener and
    // the sign-in call itself), so a read-then-write would let both take the
    // create branch and both reset createdAt and credits. `create()` is atomic:
    // the loser gets ALREADY_EXISTS and falls through to the update path.
    const created = await createProfile(userRef, uid, email, req.body.displayName, req.body.photoURL);
    if (created) {
      log.info('User profile created', { userId: uid });
      return res.status(201).json({ created: true, profile: created });
    }

    const snapshot = await userRef.get();

    if (snapshot.exists) {
      const data = snapshot.data()!;

      if (data.status === 'blocked') {
        return res.status(403).json({
          error: 'Account blocked',
          message: 'Your account has been blocked due to policy violations.',
        });
      }

      // Email/password signup sets the display name a moment after the account
      // exists, so the first call can arrive without one. Fill it in rather
      // than leaving the profile permanently nameless.
      const displayName = data.displayName || req.body.displayName || null;

      await userRef.update(
        stripUndefined({
          lastLoginAt: FieldValue.serverTimestamp(),
          displayName: data.displayName ? undefined : (req.body.displayName ?? undefined),
        }),
      );

      return res.json({
        created: false,
        profile: {
          uid,
          email: data.email ?? email ?? null,
          displayName,
          photoURL: data.photoURL ?? null,
          role: data.role === 'admin' ? 'admin' : 'user',
          status: data.status ?? 'active',
          credits: data.credits ?? 0,
        },
      });
    }

    // `create()` said the document exists and the read said it does not, which
    // only happens if it was deleted in between.
    return res.status(404).json({ error: 'User not found' });
  }),
);

/**
 * Send login notification email
 * POST /api/auth/login-notification
 */
router.post(
  '/login-notification',
  authMiddleware,
  requireActiveUser,
  validate(loginNotificationSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    // The uid comes from the verified token, so this endpoint can no longer be
    // used as a user-existence probe or an email spam trigger (SEC-14).
    const userId = req.user!.uid;
    const { loginTime } = req.body;
    log.debug('Login notification requested', { userId });

    // Get user details from Firestore instead of Firebase Admin Auth
    const userDoc = await collections.users.doc(userId).get();

    if (!userDoc.exists) {
      log.warn('Login notification for unknown user', { userId });
      return res.status(404).json({ error: 'User not found in Firestore' });
    }

    const userData = userDoc.data()!;
    const userEmail = userData.email;
    const userName = userData.displayName || userData.email?.split('@')[0] || 'User';

    if (!userEmail) {
      return res.status(400).json({ error: 'User email not found' });
    }

    // Default value if not provided
    const loginTimeFormatted = loginTime || new Date().toLocaleString();

    // Send login notification email
    const emailSent = await sendLoginNotification(userEmail, userName, loginTimeFormatted);

    if (emailSent) {
      log.info('Login notification sent', { userId });
      res.json({
        success: true,
        message: 'Login notification sent successfully',
        userEmail: userEmail.replace(/(.{2}).*(@)/, '$1***$2'), // Mask email for privacy
      });
    } else {
      log.warn('Login notification not sent, email transport unavailable', { userId });
      throw new AppError('Failed to send login notification email', 500);
    }
  }),
);

export default router;
