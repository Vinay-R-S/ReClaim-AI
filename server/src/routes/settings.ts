/**
 * Settings Routes - Handle system configuration
 */

import { Router, Request, Response } from 'express';
import { collections } from '../utils/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

const router = Router();

export type AIProvider = 'groq_only' | 'gemini_only' | 'groq_with_fallback' | 'gemini_with_fallback';

export interface SystemSettings {
    aiProvider: AIProvider;
    updatedAt?: FirebaseFirestore.FieldValue;
}

const SETTINGS_DOC_ID = 'system';

// Default settings
const DEFAULT_SETTINGS: SystemSettings = {
    aiProvider: 'groq_only',
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
        const { aiProvider } = req.body;

        // Validate aiProvider
        const validProviders: AIProvider[] = ['groq_only', 'gemini_only', 'groq_with_fallback', 'gemini_with_fallback'];
        if (!validProviders.includes(aiProvider)) {
            return res.status(400).json({ error: 'Invalid AI provider' });
        }

        const settings: SystemSettings = {
            aiProvider,
            updatedAt: FieldValue.serverTimestamp(),
        };

        await collections.settings.doc(SETTINGS_DOC_ID).set(settings, { merge: true });

        console.log('Settings updated:', settings);

        return res.json({ success: true, ...settings });
    } catch (error) {
        console.error('Update settings error:', error);
        return res.status(500).json({ error: 'Failed to update settings' });
    }
});

export default router;
