/**
 * System settings.
 *
 * The shape is shared with the client, which reads the same document through
 * `GET /api/settings`; only the write-time timestamp is server-only.
 */

import type { AIProvider, SystemSettings as SharedSettings } from '../../../shared/domain.js';

export type { AIProvider, MapCenter, SystemSettingsResponse } from '../../../shared/domain.js';

export interface SystemSettings extends SharedSettings {
  updatedAt?: FirebaseFirestore.FieldValue;
}

export const DEFAULT_SETTINGS: SystemSettings = {
  aiProvider: 'groq_only' as AIProvider,
  cctvEnabled: true,
  testingMode: false,
};

/** The daily call budget testing mode applies. */
export const TESTING_DAILY_LIMIT = 400;
