/**
 * System settings and the visitor counter.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { SettingsRepository, settingsRepository } from '../repositories/settings.repository.js';
import { UserRepository, userRepository } from '../repositories/user.repository.js';
import { isCloudinaryConfigured, uploadImage } from './cloudinary.service.js';
import { auth } from '../utils/firebase-admin.js';
import { getAvailableProviders, type LLMProvider } from '../utils/llm.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import { createLogger } from '../utils/logger.js';
import {
  DEFAULT_SETTINGS,
  TESTING_DAILY_LIMIT,
  type AIProvider,
  type SystemSettings,
} from '../types/settings.types.js';
import type { SettingsUpdateBody } from '../schemas/index.js';

const log = createLogger('settings.service');

/** The provider a setting makes primary. A missing key here breaks every LLM call. */
const PRIMARY_PROVIDER: Record<AIProvider, LLMProvider> = {
  groq_only: 'groq',
  groq_with_fallback: 'groq',
  gemini_only: 'gemini',
  gemini_with_fallback: 'gemini',
  grok_only: 'grok',
  grok_with_fallback: 'grok',
};

export class SettingsService {
  constructor(
    private readonly settings: SettingsRepository = settingsRepository,
    private readonly users: UserRepository = userRepository,
  ) {}

  /**
   * The settings, plus which providers this deployment can actually reach.
   *
   * The admin screen needs the second part so it can stop someone selecting a
   * provider with no key and silently killing matching and CCTV description.
   */
  async getSystem(): Promise<Record<string, unknown>> {
    const stored = await this.settings.getSystem();

    return { ...(stored ?? DEFAULT_SETTINGS), availableProviders: getAvailableProviders() };
  }

  async updateSystem(body: SettingsUpdateBody): Promise<SystemSettings> {
    const { aiProvider, mapCenter, cctvEnabled, testingMode } = body;
    const required = PRIMARY_PROVIDER[aiProvider as AIProvider];

    if (required && !getAvailableProviders().includes(required)) {
      throw new AppError(
        `${required} has no API key configured on this server, so selecting it would stop every AI feature`,
        400,
      );
    }

    const settings: SystemSettings = {
      aiProvider: aiProvider as AIProvider,
      cctvEnabled: cctvEnabled !== false,
      testingMode: testingMode === true,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (typeof mapCenter?.lat === 'number' && typeof mapCenter?.lng === 'number') {
      settings.mapCenter = {
        address: mapCenter.address || '',
        lat: mapCenter.lat,
        lng: mapCenter.lng,
      };
    }

    await this.settings.saveSystem(settings);

    log.info('Settings updated:', settings);

    return settings;
  }

  /**
   * Which mode the deployment is in. Public, because the welcome page decides
   * whether to render at all from this.
   *
   * Never throws: a settings read that fails must not stop the site loading.
   */
  async getMode(): Promise<{ testingMode: boolean; dailyLimit: number | null }> {
    try {
      const stored = (await this.settings.getSystem()) ?? DEFAULT_SETTINGS;
      const testingMode = stored.testingMode === true;

      return { testingMode, dailyLimit: testingMode ? TESTING_DAILY_LIMIT : null };
    } catch (error) {
      log.error('Get mode error:', error);

      return { testingMode: false, dailyLimit: null };
    }
  }

  recordVisit(): Promise<void> {
    return this.settings.recordVisit();
  }

  async getAnalytics(): Promise<{ visitorCount: number; lastVisit: unknown }> {
    const stored = await this.settings.getAnalytics();

    return {
      visitorCount: (stored?.visitorCount as number) || 0,
      lastVisit: stored?.lastVisit ?? null,
    };
  }

  /**
   * Store an avatar.
   *
   * The uid is the caller's own, taken from the verified token: a `userId` in
   * the body is ignored, otherwise anyone could overwrite another account's
   * avatar (defect SEC-07).
   */
  async setProfilePicture(userId: string, imageData: string): Promise<string> {
    if (!isCloudinaryConfigured()) {
      throw new AppError('Image upload service not configured', 500);
    }

    let photoURL = '';

    try {
      const result = await uploadImage(imageData, 'profile-pictures');
      photoURL = result.url;
    } catch (error) {
      log.error('Profile picture upload failed', { error });
      throw new AppError('Failed to upload profile picture', 500);
    }

    await this.users.merge(userId, { photoURL, updatedAt: FieldValue.serverTimestamp() });

    // The Firestore document is what the app reads; the auth profile is a
    // convenience, so a failure there is logged and not raised.
    try {
      await auth.updateUser(userId, { photoURL });
    } catch (error) {
      log.error('Failed to update auth profile:', error);
    }

    return photoURL;
  }
}

export const settingsService = new SettingsService();
