/**
 * Settings persistence.
 *
 * Two documents live in this collection: `system`, which the admin screen
 * edits, and `analytics`, which holds the visitor counter.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';

export const SYSTEM_SETTINGS_DOC = 'system';
export const ANALYTICS_DOC = 'analytics';

export class SettingsRepository {
  constructor(private readonly settings = collections.settings) {}

  async getSystem(): Promise<Record<string, unknown> | null> {
    const doc = await this.settings.doc(SYSTEM_SETTINGS_DOC).get();

    return doc.exists ? (doc.data() ?? null) : null;
  }

  async saveSystem(data: object): Promise<void> {
    await this.settings.doc(SYSTEM_SETTINGS_DOC).set(data, { merge: true });
  }

  async getAnalytics(): Promise<Record<string, unknown> | null> {
    const doc = await this.settings.doc(ANALYTICS_DOC).get();

    return doc.exists ? (doc.data() ?? null) : null;
  }

  /**
   * Whether `migrate:handovers` has run.
   *
   * Read on the user handover list so it can stop paying for the legacy scan
   * once every record carries `participantIds`.
   */
  async handoverParticipantsBackfilled(): Promise<boolean> {
    const settings = await this.getSystem();

    return settings?.handoverParticipantsBackfilled === true;
  }

  async recordVisit(): Promise<void> {
    await this.settings.doc(ANALYTICS_DOC).set(
      {
        visitorCount: FieldValue.increment(1),
        lastVisit: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}

export const settingsRepository = new SettingsRepository();
