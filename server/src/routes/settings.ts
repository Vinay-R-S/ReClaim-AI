/**
 * Settings Routes - Handle system configuration
 */

import { Router, Request, Response } from 'express';
import { collections, auth } from '../utils/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { uploadImage, isCloudinaryConfigured } from '../services/cloudinary.js';

const router = Router();

export type AIProvider = 'groq_only' | 'gemini_only' | 'groq_with_fallback' | 'gemini_with_fallback';

export interface MapCenter {
    address: string;
    lat: number;
    lng: number;
}

export interface SystemSettings {
    aiProvider: AIProvider;
    mapCenter?: MapCenter;
    cctvEnabled: boolean;
    testingMode: boolean;  // true = Testing (400 calls/day limit), false = Dev (unlimited)
    updatedAt?: FirebaseFirestore.FieldValue;
}

const SETTINGS_DOC_ID = 'system';

// Default settings
const DEFAULT_SETTINGS: SystemSettings = {
    aiProvider: 'groq_only',
    cctvEnabled: true,
    testingMode: false,  // Default to Dev mode (no rate limiting)
};

/**
 * GET /api/settings
 * Get current system settings
 */
router.get('/', async (_req: Request, res: Response) => {
    try {
        const doc = await collections.settings.doc(SETTINGS_DOC_ID).get();

        if (!doc.exists) {
            // Return default settings if not configured
            return res.json(DEFAULT_SETTINGS);
        }

        return res.json(doc.data());
    } catch (error) {
        console.error('Get settings error:', error);
        return res.status(500).json({ error: 'Failed to get settings' });
    }
});

/**
 * PUT /api/settings
 * Update system settings
 */
router.put('/', async (req: Request, res: Response) => {
    try {
        const { aiProvider, mapCenter, cctvEnabled, testingMode } = req.body;

        // Validate aiProvider
        const validProviders: AIProvider[] = ['groq_only', 'gemini_only', 'groq_with_fallback', 'gemini_with_fallback'];
        if (!validProviders.includes(aiProvider)) {
            return res.status(400).json({ error: 'Invalid AI provider' });
        }

        const settings: SystemSettings = {
            aiProvider,
            cctvEnabled: cctvEnabled !== false, // Default to true if not specified
            testingMode: testingMode === true,  // Default to false (Dev mode) if not specified
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Add mapCenter if provided
        if (mapCenter && mapCenter.lat && mapCenter.lng) {
            settings.mapCenter = {
                address: mapCenter.address || '',
                lat: mapCenter.lat,
                lng: mapCenter.lng,
            };
        }

        await collections.settings.doc(SETTINGS_DOC_ID).set(settings, { merge: true });

        console.log('Settings updated:', settings);

        return res.json({ success: true, ...settings });
    } catch (error) {
        console.error('Update settings error:', error);
        return res.status(500).json({ error: 'Failed to update settings' });
    }
});

/**
 * POST /api/settings/profile-picture
 * Upload profile picture for a user
 */
router.post('/profile-picture', async (req: Request, res: Response) => {
    try {
        const { userId, imageData } = req.body as {
            userId: string;
            imageData: string; // Base64 encoded image
        };

        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }

        if (!imageData) {
            return res.status(400).json({ error: 'Image data required' });
        }

        // Note: User is already authenticated on client side, so we trust the userId
        // No need for strict verification - proceed with upload

        // Upload to Cloudinary if configured
        let photoURL = '';
        if (isCloudinaryConfigured()) {
            try {
                const result = await uploadImage(imageData, 'profile-pictures');
                photoURL = result.url;
            } catch (uploadError) {
                console.error('Profile picture upload failed:', uploadError);
                return res.status(500).json({ error: 'Failed to upload profile picture' });
            }
        } else {
            return res.status(500).json({ error: 'Image upload service not configured' });
        }

        // Update Firestore user document (use set with merge to create if doesn't exist)
        await collections.users.doc(userId).set({
            photoURL,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Update Firebase Auth profile
        try {
            await auth.updateUser(userId, { photoURL });
        } catch (authError) {
            console.error('Failed to update auth profile:', authError);
            // Continue even if auth update fails, Firestore is updated
        }

        return res.json({ success: true, photoURL });
    } catch (error) {
        console.error('Profile picture upload error:', error);
        return res.status(500).json({ error: 'Failed to upload profile picture' });
    }
});

/**
 * GET /api/settings/mode
 * Get current mode (testing or dev) - public endpoint for welcome page logic
 */
router.get('/mode', async (_req: Request, res: Response) => {
    try {
        const doc = await collections.settings.doc(SETTINGS_DOC_ID).get();
        const data = doc.exists ? doc.data() : DEFAULT_SETTINGS;

        return res.json({
            testingMode: data?.testingMode === true,
            dailyLimit: data?.testingMode === true ? 400 : null
        });
    } catch (error) {
        console.error('Get mode error:', error);
        return res.json({ testingMode: false, dailyLimit: null });
    }
});

/**
 * POST /api/settings/visit
 * Track a visitor - public endpoint, increments visitor count
 */
router.post('/visit', async (_req: Request, res: Response) => {
    try {
        const analyticsDoc = collections.settings.doc('analytics');

        await analyticsDoc.set({
            visitorCount: FieldValue.increment(1),
            lastVisit: FieldValue.serverTimestamp()
        }, { merge: true });

        return res.json({ success: true });
    } catch (error) {
        console.error('Track visit error:', error);
        return res.status(500).json({ error: 'Failed to track visit' });
    }
});

/**
 * GET /api/settings/analytics
 * Get visitor analytics - admin only (secret)
 */
router.get('/analytics', async (_req: Request, res: Response) => {
    try {
        const doc = await collections.settings.doc('analytics').get();

        if (!doc.exists) {
            return res.json({ visitorCount: 0 });
        }

        const data = doc.data();
        return res.json({
            visitorCount: data?.visitorCount || 0,
            lastVisit: data?.lastVisit || null
        });
    } catch (error) {
        console.error('Get analytics error:', error);
        return res.status(500).json({ error: 'Failed to get analytics' });
    }
});

export default router;
