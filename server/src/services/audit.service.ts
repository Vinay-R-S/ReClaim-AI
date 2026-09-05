/**
 * Admin decision audit trail.
 *
 * Moderation and match verification both overwrite fields on the item
 * (`moderation`, `verifiedBy`), so the item alone only ever shows the latest
 * decision. This collection keeps every decision, which is what "who approved,
 * who verified, when, and the outcome" actually requires.
 *
 * Handover overrides and code re-issues have their own trail in
 * `handoverAudit`; this one covers the review workflow.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import { AdminAuditAction, AdminAuditEntry } from '../types/index.js';
import { stripUndefined } from '../utils/firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('audit');

/** Newest first, and bounded: the trail is unbounded in principle. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface RecordOptions {
  action: AdminAuditAction;
  targetId: string;
  actorId: string;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Write one decision.
 *
 * Never throws. An audit write failing must not undo a decision the admin has
 * already been told succeeded, and must not fail the request that made it.
 */
export async function recordAdminAction(options: RecordOptions): Promise<void> {
  try {
    await collections.adminAudit.add(
      stripUndefined({
        action: options.action,
        targetId: options.targetId,
        actorId: options.actorId,
        reason: options.reason,
        details: options.details,
        createdAt: FieldValue.serverTimestamp(),
      }),
    );
  } catch (error) {
    log.error(`Failed to record admin action ${options.action} on ${options.targetId}`, error);
  }
}

/**
 * Read the trail for one item, newest first.
 */
export async function listAdminAuditForTarget(
  targetId: string,
  limit = DEFAULT_LIMIT,
): Promise<AdminAuditEntry[]> {
  const bounded = Math.min(Math.max(limit, 1), MAX_LIMIT);

  // Ordered in memory rather than with `orderBy`, which would need a composite
  // index on (targetId, createdAt) for a list that is a handful of entries long.
  const snapshot = await collections.adminAudit.where('targetId', '==', targetId).get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as AdminAuditEntry)
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
    .slice(0, bounded);
}
