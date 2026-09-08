/**
 * Exactly-once execution for jobs that are delivered at least once.
 *
 * A queue guarantees delivery, never single delivery: a worker that dies after
 * doing the work but before acknowledging it will be handed the same job
 * again. Every handler therefore claims its key first, and only the claim
 * holder runs. The claim is a lease, so a worker that dies mid-job releases it
 * by expiry rather than blocking the key forever.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('idempotency');

/** How long a completed key is remembered before Firestore TTL removes it. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type ClaimOutcome =
  { claimed: true; attempt: number } | { claimed: false; reason: 'completed' | 'in_flight' };

interface ClaimRecord {
  key: string;
  jobName: string;
  status: 'running' | 'completed';
  attempt: number;
  leaseExpiresAt: Timestamp | null;
  updatedAt: Timestamp;
  /** Read by the Firestore TTL policy on this collection. */
  expiresAt: Timestamp;
}

export class IdempotencyRepository {
  constructor(private readonly claims = collections.jobClaims) {}

  /**
   * Take the key, or say why it could not be taken.
   *
   * The whole decision happens inside one transaction because two workers
   * racing on the same key is the case this exists for.
   */
  async claim(key: string, jobName: string, leaseMs: number): Promise<ClaimOutcome> {
    const ref = this.claims.doc(key);
    const now = Date.now();

    return this.claims.firestore.runTransaction<ClaimOutcome>(async (tx) => {
      const snapshot = await tx.get(ref);
      const existing = snapshot.exists ? (snapshot.data() as ClaimRecord) : null;

      if (existing?.status === 'completed') {
        return { claimed: false, reason: 'completed' };
      }

      const leaseHeld = Boolean(
        existing?.leaseExpiresAt && existing.leaseExpiresAt.toMillis() > now,
      );

      if (existing && leaseHeld) {
        return { claimed: false, reason: 'in_flight' };
      }

      const attempt = (existing?.attempt ?? 0) + 1;

      tx.set(ref, {
        key,
        jobName,
        status: 'running',
        attempt,
        leaseExpiresAt: Timestamp.fromMillis(now + leaseMs),
        updatedAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + RETENTION_MS),
      } satisfies ClaimRecord);

      return { claimed: true, attempt };
    });
  }

  /** The work is done and must never run again for this key. */
  async complete(key: string): Promise<void> {
    const now = Date.now();

    await this.claims.doc(key).set(
      {
        status: 'completed',
        leaseExpiresAt: null,
        updatedAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + RETENTION_MS),
      },
      { merge: true },
    );
  }

  /**
   * The attempt failed. Dropping the lease lets the retry start immediately
   * instead of waiting the lease out.
   */
  async release(key: string): Promise<void> {
    try {
      await this.claims
        .doc(key)
        .set(
          { status: 'running', leaseExpiresAt: null, updatedAt: Timestamp.now() },
          { merge: true },
        );
    } catch (error) {
      // The retry still works; it just waits for the lease to expire first.
      log.warn('Could not release a job claim', { key, error });
    }
  }
}

export const idempotencyRepository = new IdempotencyRepository();
