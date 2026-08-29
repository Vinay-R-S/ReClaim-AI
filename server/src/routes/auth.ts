/**
 * Auth Routes - Login notifications and authentication-related endpoints
 */

import express from 'express';
import { sendLoginNotification } from '../services/email.js';
import { collections } from '../utils/firebase-admin.js';
import { createLogger } from '../utils/logger.js';
import {
  asyncHandler,
  authMiddleware,
  AuthRequest,
  requireActiveUser,
} from '../middleware/index.js';
import { AppError } from '../middleware/index.js';

const log = createLogger('auth');

const router = express.Router();

/**
 * Send login notification email
 * POST /api/auth/login-notification
 */
router.post(
  '/login-notification',
  authMiddleware,
  requireActiveUser,
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
