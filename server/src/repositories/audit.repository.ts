/**
 * Admin decision trail.
 *
 * Moderation and match verification both overwrite fields on the item, so the
 * item alone only ever shows the latest decision. This collection keeps every
 * one of them.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import { stripUndefined } from '../utils/firestore.js';
import type { AdminAuditEntry } from '../types/index.js';

export class AuditRepository {
  constructor(private readonly entries = collections.adminAudit) {}

  async add(entry: Record<string, unknown>): Promise<void> {
    await this.entries.add(stripUndefined({ ...entry, createdAt: FieldValue.serverTimestamp() }));
  }

  /**
   * Every entry for one target.
   *
   * Unordered on purpose: `orderBy` here would need a composite index on
   * (targetId, createdAt) for a list that is a handful of entries long, so the
   * caller sorts what comes back.
   */
  async listForTarget(targetId: string): Promise<AdminAuditEntry[]> {
    const snapshot = await this.entries.where('targetId', '==', targetId).get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as AdminAuditEntry);
  }
}

export const auditRepository = new AuditRepository();
