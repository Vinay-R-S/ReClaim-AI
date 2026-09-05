/**
 * Settings Routes - Handle system configuration
 */

import { Router, Request, Response } from 'express';
import { collections, auth } from '../utils/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { uploadImage, isCloudinaryConfigured } from '../services/cloudinary.js';
import { createLogger } from '../utils/logger.js';
import {
  AuthRequest,
  asyncHandler,
  authMiddleware,
  requireActiveUser,
  requireAdmin,
  validate,
} from '../middleware/index.js';
import { profilePictureSchema, settingsUpdateSchema } from '../schemas/index.js';
import { getAvailableProviders, type LLMProvider } from '../utils/llm.js';
import { AppError } from '../middleware/index.js';

const log = createLogger('settings');

const router = Router();

export type AIProvider =
  | 'groq_only'
  | 'gemini_only'
  | 'grok_only'
  | 'groq_with_fallback'
  | 'gemini_with_fallback'
  | 'grok_with_fallback';

export interface MapCenter {
  address: string;
  lat: number;
  lng: number;
}

export interface SystemSettings {
  aiProvider: AIProvider;
  mapCenter?: MapCenter;
  cctvEnabled: boolean;
  testingMode: boolean; // true = Testing (400 calls/day limit), false = Dev (unlimited)
  updatedAt?: FirebaseFirestore.FieldValue;
}

const SETTINGS_DOC_ID = 'system';

// Default settings
/** The provider a setting makes primary. A missing key here breaks every LLM call. */
const PRIMARY_PROVIDER: Record<AIProvider, LLMProvider> = {
  groq_only: 'groq',
  groq_with_fallback: 'groq',
  gemini_only: 'gemini',
  gemini_with_fallback: 'gemini',
  grok_only: 'grok',
  grok_with_fallback: 'grok',
};

const DEFAULT_SETTINGS: SystemSettings = {
  aiProvider: 'groq_only',
  cctvEnabled: true,
  testingMode: false, // Default to Dev mode (no rate limiting)
};

/**
 * GET /api/settings
 * Get current system settings
 */
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (_req: Request, res: Response) => {
    const doc = await collections.settings.doc(SETTINGS_DOC_ID).get();

    // The admin screen needs to know which providers this deployment can
    // actually reach, so it can stop someone selecting one with no key and
    // silently killing matching and CCTV description.
    const availableProviders = getAvailableProviders();

    if (!doc.exists) {
      // Return default settings if not configured
      return res.json({ ...DEFAULT_SETTINGS, availableProviders });
    }

    return res.json({ ...doc.data(), availableProviders });
  }),
);

/**
 * PUT /api/settings
 * Update system settings
 */
router.put(
  '/',
  authMiddleware,
  requireAdmin,
  validate(settingsUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { aiProvider, mapCenter, cctvEnabled, testingMode } = req.body;

    const required = PRIMARY_PROVIDER[aiProvider as AIProvider];

    if (required && !getAvailableProviders().includes(required)) {
      return res.status(400).json({
        error: `${required} has no API key configured on this server, so selecting it would stop every AI feature`,
      });
    }

    const settings: SystemSettings = {
      aiProvider,
      cctvEnabled: cctvEnabled !== false, // Default to true if not specified
      testingMode: testingMode === true, // Default to false (Dev mode) if not specified
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Add mapCenter if provided
    if (typeof mapCenter?.lat === 'number' && typeof mapCenter?.lng === 'number') {
      settings.mapCenter = {
        address: mapCenter.address || '',
        lat: mapCenter.lat,
        lng: mapCenter.lng,
      };
    }

    await collections.settings.doc(SETTINGS_DOC_ID).set(settings, { merge: true });

    log.info('Settings updated:', settings);

    return res.json({ success: true, ...settings });
  }),
);

/**
 * POST /api/settings/profile-picture
 * Upload profile picture for a user
 */
router.post(
  '/profile-picture',
  authMiddleware,
  requireActiveUser,
  validate(profilePictureSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // The uid comes from the verified token. A `userId` in the body is ignored,
    // otherwise anyone could overwrite another user's avatar (SEC-07).
    const userId = req.user!.uid;
    const { imageData } = req.body as { imageData: string };

    // Upload to Cloudinary if configured
    let photoURL = '';
    if (isCloudinaryConfigured()) {
      try {
        const result = await uploadImage(imageData, 'profile-pictures');
        photoURL = result.url;
      } catch (uploadError) {
        log.error('Profile picture upload failed', { error: uploadError });
        throw new AppError('Failed to upload profile picture', 500);
      }
    } else {
      throw new AppError('Image upload service not configured', 500);
    }

    // Update Firestore user document (use set with merge to create if doesn't exist)
    await collections.users.doc(userId).set(
      {
        photoURL,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Update Firebase Auth profile
    try {
      await auth.updateUser(userId, { photoURL });
    } catch (authError) {
      log.error('Failed to update auth profile:', authError);
      // Continue even if auth update fails, Firestore is updated
    }

    return res.json({ success: true, photoURL });
  }),
);

/**
 * GET /api/settings/mode
 * Get current mode (testing or dev) - public endpoint for welcome page logic
 */
router.get(
  '/mode',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const doc = await collections.settings.doc(SETTINGS_DOC_ID).get();
      const data = doc.exists ? doc.data() : DEFAULT_SETTINGS;

      return res.json({
        testingMode: data?.testingMode === true,
        dailyLimit: data?.testingMode === true ? 400 : null,
      });
    } catch (error) {
      log.error('Get mode error:', error);
      return res.json({ testingMode: false, dailyLimit: null });
    }
  }),
);

/**
 * POST /api/settings/visit
 * Track a visitor - public endpoint, increments visitor count
 */
router.post(
  '/visit',
  asyncHandler(async (_req: Request, res: Response) => {
    const analyticsDoc = collections.settings.doc('analytics');

    await analyticsDoc.set(
      {
        visitorCount: FieldValue.increment(1),
        lastVisit: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return res.json({ success: true });
  }),
);

/**
 * GET /api/settings/analytics
 * Get visitor analytics - admin only (secret)
 */
router.get(
  '/analytics',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const doc = await collections.settings.doc('analytics').get();

    if (!doc.exists) {
      return res.json({ visitorCount: 0 });
    }

    const data = doc.data();
    return res.json({
      visitorCount: data?.visitorCount || 0,
      lastVisit: data?.lastVisit || null,
    });
  }),
);

export default router;
