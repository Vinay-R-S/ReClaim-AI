import crypto from 'crypto';
import { collections, db } from '../utils/firebase-admin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import { Item } from '../types/index.js';
import { HandoverCode, HandoverCodeHashVersion } from '../types/handover.js';
import {
  sendHandoverCodeToLostPerson,
  sendHandoverLinkToFoundPerson,
  sendHandoverBlockedNotice,
} from './email.js';
import { haversineDistance, calculateTimeDifference } from '../utils/scoring.js';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';

const log = createLogger('handover');

const HANDOVER_CONFIG = {
  MAX_ATTEMPTS: 3,
  CODE_EXPIRY_DAYS: 7,
  LOCATION_RADIUS_KM: 0.6, // 600 meters
  TIME_WINDOW_HOURS: 2, // +/- 2 hours
};

/** Codes issued from now on. Older documents carry version 1 or nothing. */
const CURRENT_HASH_VERSION: HandoverCodeHashVersion = 2;

/** How many admins are notified when a session blocks. */
const ADMIN_NOTIFY_LIMIT = 5;

export interface InitiateHandoverOptions {
  /** Admin uid, set when a human triggered the handover rather than matching. */
  actorId?: string;
  /** Issue the code even though the strict criteria fail. Admin only. */
  overrideCriteria?: boolean;
  overrideReason?: string;
  /** Reset a blocked session and issue a fresh code. Admin only. */
  reissueBlocked?: boolean;
}

type IssueOutcome =
  | { kind: 'already_completed' }
  | { kind: 'blocked' }
  | {
      kind: 'issued';
      previousStatus: HandoverCode['status'] | null;
      previousAttempts: number;
      hadExisting: boolean;
    };

export interface HandoverResult {
  success: boolean;
  message: string;
  /** Set when the refusal was a failed criteria check an admin may override. */
  criteriaFailure?: string;
}

/**
 * Validate strict handover criteria.
 *
 * Returns an error string when the pair must not be handed over, null when it
 * may. A check that cannot be evaluated (no coordinates, no date) is a failure,
 * not a pass: silently treating unknown as valid is what let unrelated items
 * through before.
 */
export function validateHandoverCriteria(lostItem: Item, foundItem: Item): string | null {
  const radiusMetres = Math.round(HANDOVER_CONFIG.LOCATION_RADIUS_KM * 1000);

  // 1. Location, by coordinates when both sides have them
  if (lostItem.coordinates && foundItem.coordinates) {
    const dist = haversineDistance(
      lostItem.coordinates.lat,
      lostItem.coordinates.lng,
      foundItem.coordinates.lat,
      foundItem.coordinates.lng,
    );

    if (dist > HANDOVER_CONFIG.LOCATION_RADIUS_KM) {
      return `Location mismatch: items are ${dist.toFixed(2)}km apart (max ${radiusMetres}m allowed)`;
    }
  } else if (!sameLocationText(lostItem.location, foundItem.location)) {
    // Without coordinates the only evidence left is the typed location. Equal
    // text is accepted, anything else is unverifiable and therefore a failure.
    return `Location cannot be verified: one of the items has no coordinates and the reported locations differ`;
  }

  // 2. Date, same calendar day
  const lostDate = toDate(lostItem.date);
  const foundDate = toDate(foundItem.date);

  if (!lostDate || !foundDate) {
    return `Date missing: both items must carry a report date to be handed over`;
  }

  const isSameDay =
    lostDate.getFullYear() === foundDate.getFullYear() &&
    lostDate.getMonth() === foundDate.getMonth() &&
    lostDate.getDate() === foundDate.getDate();

  if (!isSameDay) {
    return `Date mismatch: items reported on different days`;
  }

  // 3. Time window
  const timeDiffHours = calculateTimeDifference(lostDate, foundDate);
  if (timeDiffHours > HANDOVER_CONFIG.TIME_WINDOW_HOURS) {
    return `Time mismatch: items are ${timeDiffHours.toFixed(1)} hours apart (max ${HANDOVER_CONFIG.TIME_WINDOW_HOURS} hours allowed)`;
  }

  return null;
}

function sameLocationText(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Generate a 6-digit code from the CSPRNG.
 *
 * `randomInt` is uniform over the range, unlike the old `Math.random()` which
 * was both biased and predictable from a handful of observed codes.
 */
function generateVerificationCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hash a code for storage.
 *
 * Version 1 was a bare SHA-256 of six digits, a space of one million that a
 * leaked hash gives up instantly. Version 2 is HMAC-SHA256 under a server-held
 * key, so a leaked hash is worthless without the key.
 */
function hashCode(code: string, version: HandoverCodeHashVersion): string {
  if (version === 1) {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  return crypto.createHmac('sha256', env.handover.codeSecret).update(code).digest('hex');
}

function codeMatches(code: string, stored: HandoverCode): boolean {
  const version: HandoverCodeHashVersion = stored.codeHashVersion === 2 ? 2 : 1;
  const expected = Buffer.from(stored.codeHash || '', 'utf8');
  const actual = Buffer.from(hashCode(code, version), 'utf8');

  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Convert a Firestore timestamp to a Date, or null when there is no value.
 *
 * Returning `new Date()` for a missing value made every date check pass, which
 * is the opposite of what an absent date should mean.
 */
function toDate(val: unknown): Date | null {
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;

  if (val && typeof val === 'object') {
    const candidate = val as { toDate?: () => Date; seconds?: number };

    if (typeof candidate.toDate === 'function') {
      const converted = candidate.toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }

    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000);
  }

  if (typeof val === 'string' || typeof val === 'number') {
    const parsed = new Date(val);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/**
 * Report what actually happened to a credit award.
 *
 * A failed transaction returns `success: false` with the intended amount still
 * on the result, so branching only on `alreadyApplied` logged an award that was
 * never written and left nothing to reconcile from.
 */
function logCreditOutcome(
  role: string,
  userId: string,
  result: { success: boolean; alreadyApplied: boolean; amount: number },
): void {
  if (!result.success) {
    log.error(`Credit award FAILED for ${role} ${userId}, balance unchanged`);
    return;
  }

  if (result.alreadyApplied) {
    log.info(`Credits already recorded for ${role} ${userId}`);
    return;
  }

  log.info(`Credits awarded to ${role} ${userId}: +${result.amount}`);
}

async function writeAuditEntry(
  action: string,
  matchId: string,
  actorId: string | undefined,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await collections.handoverAudit.add({
      action,
      matchId,
      actorId: actorId || null,
      details,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // An audit write must never take the operation down with it.
    log.error(`Failed to write handover audit entry for ${action}`, error);
  }
}

/**
 * Resolve the one code document for a match.
 *
 * New sessions live at `handoverCodes/{matchId}`, so two concurrent initiates
 * address the same document instead of each adding one and emailing a code the
 * other invalidates. Documents created before this phase carry a random id, so
 * a miss falls back to a query and, if duplicates already exist, takes the
 * newest rather than an arbitrary one.
 */
async function resolveCodeRef(matchId: string): Promise<DocumentReference> {
  const direct = collections.handoverCodes.doc(matchId);
  const directSnap = await direct.get();

  if (directSnap.exists) return direct;

  const legacy = await collections.handoverCodes.where('matchId', '==', matchId).get();

  if (legacy.empty) return direct;

  const newest = legacy.docs.reduce((latest, doc) => {
    const a = toDate(doc.data()?.createdAt)?.getTime() ?? 0;
    const b = toDate(latest.data()?.createdAt)?.getTime() ?? 0;
    return a > b ? doc : latest;
  });

  return newest.ref;
}

/**
 * Initiate the handover process: issue a code and email both parties.
 *
 * Refuses when the strict criteria fail, unless an admin passes
 * `overrideCriteria`. Refuses to touch a session that is already verified, and
 * refuses to reset a blocked one unless an admin passes `reissueBlocked`.
 */
export async function initiateHandover(
  matchId: string,
  lostItemId: string,
  foundItemId: string,
  options: InitiateHandoverOptions = {},
): Promise<HandoverResult> {
  try {
    const [lostDoc, foundDoc] = await Promise.all([
      collections.items.doc(lostItemId).get(),
      collections.items.doc(foundItemId).get(),
    ]);

    if (!lostDoc.exists || !foundDoc.exists) {
      return { success: false, message: 'Items not found' };
    }

    const lostItem = { id: lostDoc.id, ...lostDoc.data() } as Item;
    const foundItem = { id: foundDoc.id, ...foundDoc.data() } as Item;

    // 1. Criteria. Automatic handovers must pass; an admin may override.
    const criteriaFailure = validateHandoverCriteria(lostItem, foundItem);

    if (criteriaFailure && !options.overrideCriteria) {
      log.info(`Handover refused for match ${matchId}: ${criteriaFailure}`);
      return {
        success: false,
        message: `Handover criteria not met. ${criteriaFailure}`,
        criteriaFailure,
      };
    }

    // 2. Resolve both addresses before touching the code document. Failing
    //    after the write would have destroyed a code the owner already holds.
    const [lostEmail, foundEmail] = await Promise.all([
      resolveReporterEmail(lostItem),
      resolveReporterEmail(foundItem),
    ]);

    if (!lostEmail || !foundEmail) {
      return { success: false, message: 'User emails not found' };
    }

    // 3. Issue the code. The eligibility check and the write are one
    //    transaction, so a verify request cannot block the session between
    //    them and have the block overwritten by this re-issue.
    const overridden = Boolean(criteriaFailure && options.overrideCriteria);
    const code = generateVerificationCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + HANDOVER_CONFIG.CODE_EXPIRY_DAYS);

    const codeRef = await resolveCodeRef(matchId);

    const issue = await db.runTransaction<IssueOutcome>(async (tx) => {
      const snap = await tx.get(codeRef);
      const existing = snap.exists ? (snap.data() as HandoverCode) : undefined;

      if (existing?.status === 'verified') return { kind: 'already_completed' };

      if (existing?.status === 'blocked' && !options.reissueBlocked) return { kind: 'blocked' };

      // An admin re-issue clears the attempt budget; a plain re-trigger of an
      // open session keeps it, so re-running matching cannot hand out fresh
      // guesses to whoever is grinding the code.
      const carriedAttempts = existing && !options.reissueBlocked ? (existing.attempts ?? 0) : 0;

      const handoverCode: HandoverCode = {
        matchId,
        lostItemId,
        foundItemId,
        codeHash: hashCode(code, CURRENT_HASH_VERSION),
        codeHashVersion: CURRENT_HASH_VERSION,
        attempts: carriedAttempts,
        expiresAt: Timestamp.fromDate(expiresAt),
        createdAt: Timestamp.now(),
        status: 'pending',
      };

      if (overridden) {
        handoverCode.criteriaOverrideBy = options.actorId || 'unknown';
        handoverCode.criteriaOverrideReason = options.overrideReason || null;
        handoverCode.criteriaFailure = criteriaFailure as string;
      }

      // Clear whatever a previous round left behind, so a re-issued session
      // does not inherit a stale terminal state or an old override marker.
      tx.set(
        codeRef,
        {
          ...handoverCode,
          blockedAt: FieldValue.delete(),
          expiredAt: FieldValue.delete(),
          verifiedAt: FieldValue.delete(),
          completionError: FieldValue.delete(),
          ...(overridden
            ? {}
            : {
                criteriaOverrideBy: FieldValue.delete(),
                criteriaOverrideReason: FieldValue.delete(),
                criteriaFailure: FieldValue.delete(),
              }),
        },
        { merge: true },
      );

      return {
        kind: 'issued',
        previousStatus: existing?.status ?? null,
        previousAttempts: existing?.attempts ?? 0,
        hadExisting: Boolean(existing),
      };
    });

    if (issue.kind === 'already_completed') {
      return { success: false, message: 'This handover has already been completed' };
    }

    if (issue.kind === 'blocked') {
      return {
        success: false,
        message:
          'This handover is blocked after too many failed attempts and needs an admin to re-issue the code',
      };
    }

    // 4. Audit, once the code has actually been issued.
    if (overridden) {
      log.warn(`Handover criteria overridden for match ${matchId}: ${criteriaFailure}`);
      await writeAuditEntry('criteria_override', matchId, options.actorId, {
        lostItemId,
        foundItemId,
        criteriaFailure,
        reason: options.overrideReason || null,
      });
    }

    if (issue.hadExisting && options.reissueBlocked) {
      await writeAuditEntry('reissue', matchId, options.actorId, {
        lostItemId,
        foundItemId,
        previousStatus: issue.previousStatus,
        previousAttempts: issue.previousAttempts,
        reason: options.overrideReason || null,
      });
    }

    // 5. Emails. A transport failure is reported, not swallowed: the code
    //    document is left pending so an admin can re-issue.
    const verificationLink = `${env.clientUrl}/verify/${matchId}`;

    const [codeSent, linkSent] = await Promise.all([
      sendHandoverCodeToLostPerson(
        lostEmail,
        lostItem.name,
        foundEmail,
        foundItem.collectionPoint || foundItem.location,
        code,
        expiresAt.toLocaleDateString(),
      ),
      sendHandoverLinkToFoundPerson(foundEmail, foundItem.name, verificationLink),
    ]);

    if (!codeSent || !linkSent) {
      log.error(
        `Handover ${matchId} issued but email delivery failed (code: ${codeSent}, link: ${linkSent})`,
      );
      return {
        success: false,
        message: 'Handover code issued but the notification emails could not be sent',
      };
    }

    return { success: true, message: 'Handover initiated. Emails sent.' };
  } catch (error) {
    log.error('Initiate Error:', error);
    return { success: false, message: 'Internal server error' };
  }
}

async function resolveReporterEmail(item: Item): Promise<string | undefined> {
  if (item.reportedByEmail) return item.reportedByEmail;
  if (!item.reportedBy) return undefined;

  const userDoc = await collections.users.doc(item.reportedBy).get();
  return userDoc.data()?.email;
}

type VerifyOutcome =
  | { kind: 'not_found' }
  | { kind: 'blocked' }
  | { kind: 'expired' }
  | { kind: 'already_verified' }
  | { kind: 'accepted'; data: HandoverCode }
  | { kind: 'invalid'; attemptsLeft: number }
  | { kind: 'now_blocked'; data: HandoverCode };

/**
 * Verify a handover code.
 *
 * The attempt counter, the status transition and the accept decision all happen
 * inside one transaction, so parallel guesses cannot each read `attempts: 2`
 * and collectively spend more than the cap.
 */
export async function verifyHandoverCode(
  matchId: string,
  code: string,
): Promise<{ success: boolean; message: string; attemptsLeft?: number }> {
  try {
    const codeRef = await resolveCodeRef(matchId);

    const outcome = await db.runTransaction<VerifyOutcome>(async (tx) => {
      const snap = await tx.get(codeRef);

      if (!snap.exists) return { kind: 'not_found' };

      const data = snap.data() as HandoverCode;

      if (data.status === 'blocked') return { kind: 'blocked' };
      if (data.status === 'verified') return { kind: 'already_verified' };

      const expiresAt = toDate(data.expiresAt);
      if (!expiresAt || expiresAt < new Date()) {
        if (data.status !== 'expired') {
          tx.update(snap.ref, { status: 'expired', expiredAt: FieldValue.serverTimestamp() });
        }
        return { kind: 'expired' };
      }

      if (codeMatches(code, data)) {
        // Flip to verified inside the transaction: a second concurrent request
        // then reads `verified` and cannot run completion a second time.
        tx.update(snap.ref, { status: 'verified', verifiedAt: FieldValue.serverTimestamp() });
        return { kind: 'accepted', data };
      }

      const newAttempts = (data.attempts ?? 0) + 1;

      if (newAttempts >= HANDOVER_CONFIG.MAX_ATTEMPTS) {
        tx.update(snap.ref, {
          attempts: newAttempts,
          status: 'blocked',
          blockedAt: FieldValue.serverTimestamp(),
        });
        return { kind: 'now_blocked', data };
      }

      tx.update(snap.ref, { attempts: newAttempts });
      return { kind: 'invalid', attemptsLeft: HANDOVER_CONFIG.MAX_ATTEMPTS - newAttempts };
    });

    switch (outcome.kind) {
      case 'not_found':
        return { success: false, message: 'Handover session not found' };

      case 'blocked':
        return {
          success: false,
          message: 'This handover is blocked due to excessive failed attempts.',
          attemptsLeft: 0,
        };

      case 'expired':
        return { success: false, message: 'Code expired' };

      case 'already_verified':
        return { success: true, message: 'Already verified' };

      case 'invalid':
        return { success: false, message: 'Invalid code', attemptsLeft: outcome.attemptsLeft };

      case 'now_blocked':
        await onSessionBlocked(matchId, outcome.data);
        return {
          success: false,
          message: 'Too many failed attempts. Verification blocked.',
          attemptsLeft: 0,
        };

      case 'accepted': {
        const completed = await completeHandover(matchId, codeRef, outcome.data);

        if (!completed) {
          return {
            success: false,
            message: 'Verification could not be completed. Please enter the code again.',
          };
        }

        return { success: true, message: 'Verification successful! Item handed over.' };
      }

      default:
        return { success: false, message: 'Verification failed' };
    }
  } catch (error) {
    log.error('Verify Error:', error);
    return { success: false, message: 'Verification failed' };
  }
}

/**
 * Complete a verified handover.
 *
 * The code has already been accepted by the time this runs, so nothing here may
 * throw: every write is guarded by an existence check and the whole body is
 * wrapped, with the failure recorded on the code document for reconciliation.
 */
async function completeHandover(
  matchId: string,
  codeDocRef: DocumentReference,
  data: HandoverCode,
): Promise<boolean> {
  try {
    const batch = db.batch();

    const [lostItemDoc, foundItemDoc, matchDoc] = await Promise.all([
      collections.items.doc(data.lostItemId).get(),
      collections.items.doc(data.foundItemId).get(),
      collections.matches.doc(matchId).get(),
    ]);

    const lostItem = lostItemDoc.exists
      ? ({ id: lostItemDoc.id, ...lostItemDoc.data() } as Item)
      : null;
    const foundItem = foundItemDoc.exists
      ? ({ id: foundItemDoc.id, ...foundItemDoc.data() } as Item)
      : null;
    const matchData = matchDoc.exists ? matchDoc.data() : null;

    if (!lostItem || !foundItem) {
      log.warn(
        `Handover ${matchId} completing with a missing item document (lost: ${lostItemDoc.exists}, found: ${foundItemDoc.exists})`,
      );
    }

    const [lostUser, foundUser] = await Promise.all([
      loadUser(lostItem?.reportedBy),
      loadUser(foundItem?.reportedBy),
    ]);

    // 1. Handover record. Written from whatever survives, never skipped. The
    //    id is the match id, so a retry after a partial failure rewrites the
    //    same document instead of leaving a second one behind.
    const handoverRef = collections.handovers.doc(matchId);
    batch.set(handoverRef, {
      matchId,
      lostItemId: data.lostItemId,
      foundItemId: data.foundItemId,
      lostPersonId: lostItem?.reportedBy || null,
      foundPersonId: foundItem?.reportedBy || null,

      matchScore: matchData?.matchScore ?? lostItem?.matchScore ?? foundItem?.matchScore ?? 0,
      matchCreatedAt: matchData?.createdAt || null,

      lostItemDetails: itemSnapshot(lostItem),
      foundItemDetails: {
        ...itemSnapshot(foundItem),
        collectionPoint: foundItem?.collectionPoint || null,
      },

      lostPersonDetails: {
        userId: lostItem?.reportedBy || null,
        email: lostItem?.reportedByEmail || lostUser?.email || null,
        displayName: lostUser?.displayName || null,
      },
      foundPersonDetails: {
        userId: foundItem?.reportedBy || null,
        email: foundItem?.reportedByEmail || foundUser?.email || null,
        displayName: foundUser?.displayName || null,
      },

      verificationCode: data.codeHash || null, // Hashed, for reference only
      handoverTime: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      status: 'completed',
    });

    // 2. Link the completed handover back to the code document.
    batch.set(codeDocRef, { handoverId: handoverRef.id }, { merge: true });

    // 3. Archive the match, then remove it from the active collection. Both
    //    steps are skipped when the match was synthesized and never persisted.
    if (matchData) {
      batch.set(collections.matchHistory.doc(matchId), {
        ...matchData,
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        handoverId: handoverRef.id,
      });
      batch.delete(collections.matches.doc(matchId));
    }

    // 4. Items, only the ones that still exist.
    if (lostItemDoc.exists) {
      batch.update(collections.items.doc(data.lostItemId), {
        status: 'Claimed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (foundItemDoc.exists) {
      batch.update(collections.items.doc(data.foundItemId), {
        status: 'Claimed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();

    await awardHandoverCredits(data, lostItem, foundItem, lostUser?.role, foundUser?.role);
    await recordOnBlockchain(
      matchId,
      data,
      lostItem,
      foundItem,
      matchData?.matchScore ?? 0,
      handoverRef,
    );

    return true;
  } catch (error) {
    // The accept transaction already flipped the session to `verified`. Put it
    // back so the finder can simply enter the code again: leaving it verified
    // with no handover record would strand the session, since initiate and
    // re-issue both refuse a verified one.
    log.error(
      `Handover completion failed for match ${matchId}, session returned to pending`,
      error,
    );

    await codeDocRef
      .set(
        {
          status: 'pending',
          verifiedAt: FieldValue.delete(),
          completionError: 'completion_failed',
        },
        { merge: true },
      )
      .catch((revertError) => {
        log.error(`Could not return handover ${matchId} to pending`, revertError);
      });

    return false;
  }
}

function itemSnapshot(item: Item | null) {
  return {
    name: item?.name || null,
    description: item?.description || null,
    location: item?.location || null,
    date: item?.date || null,
    color: item?.color || null,
    category: item?.category || null,
    tags: item?.tags || null,
    imageUrl: item?.imageUrl || item?.cloudinaryUrls?.[0] || null,
  };
}

async function loadUser(
  userId?: string,
): Promise<{ email?: string; displayName?: string; role?: string } | null> {
  if (!userId) return null;

  const doc = await collections.users.doc(userId).get();
  if (!doc.exists) return null;

  return doc.data() as { email?: string; displayName?: string; role?: string };
}

/**
 * Award credits to both parties. Admins submit on behalf of others and are
 * skipped. Failures are logged, never propagated: the handover already happened.
 */
async function awardHandoverCredits(
  data: HandoverCode,
  lostItem: Item | null,
  foundItem: Item | null,
  lostUserRole?: string,
  foundUserRole?: string,
): Promise<void> {
  try {
    const lostUserId = lostItem?.reportedBy;
    const foundUserId = foundItem?.reportedBy;

    if (!lostUserId || !foundUserId) return;

    const { awardOwnerCredits, awardFinderCredits } = await import('./credits.js');

    // Keyed on the item, so a retried handover cannot pay out twice.
    if (lostUserRole !== 'admin') {
      logCreditOutcome(
        'lost person',
        lostUserId,
        await awardOwnerCredits(lostUserId, data.lostItemId),
      );
    } else {
      log.info(`Skipping credits for admin user ${lostUserId}`);
    }

    if (foundUserRole !== 'admin') {
      logCreditOutcome(
        'found person',
        foundUserId,
        await awardFinderCredits(foundUserId, data.foundItemId),
      );
    } else {
      log.info(`Skipping credits for admin user ${foundUserId}`);
    }
  } catch (creditError) {
    log.error('Failed to award handover credits:', creditError);
  }
}

async function recordOnBlockchain(
  matchId: string,
  data: HandoverCode,
  lostItem: Item | null,
  foundItem: Item | null,
  matchScore: number,
  handoverRef: DocumentReference,
): Promise<void> {
  if (!env.blockchain.enabled) {
    log.info('Blockchain disabled in config, skipping...');
    return;
  }

  try {
    log.info('Recording handover on blockchain...');
    const { recordHandoverOnBlockchain } = await import('./blockchain.service.js');

    const result = await recordHandoverOnBlockchain({
      matchId,
      lostItemId: data.lostItemId,
      foundItemId: data.foundItemId,
      lostPersonId: lostItem?.reportedBy || '',
      foundPersonId: foundItem?.reportedBy || '',
      itemDetails: {
        lostItemName: lostItem?.name || '',
        foundItemName: foundItem?.name || '',
        location: foundItem?.collectionPoint || foundItem?.location || '',
        matchScore,
      },
    });

    if (!result.success) {
      log.error(`Blockchain recording failed: ${result.error}`);
      await handoverRef.update({ blockchainRecorded: false, blockchainError: result.error });
      return;
    }

    log.info(`Blockchain record created: ${result.txHash}`);
    await handoverRef.update({
      blockchainTxHash: result.txHash,
      blockchainRecorded: true,
      blockchainRecordedAt: FieldValue.serverTimestamp(),
    });
  } catch (blockchainError) {
    log.error('Blockchain integration error:', blockchainError);
  }
}

/**
 * Handle a session that just hit the attempt cap.
 *
 * The session is blocked, no account is. Blocking the owner punished the party
 * that was not even typing, which let a finder lock an owner out on purpose.
 * The match is left in place so an admin can review it and re-issue.
 */
async function onSessionBlocked(matchId: string, data: HandoverCode): Promise<void> {
  await writeAuditEntry('session_blocked', matchId, undefined, {
    lostItemId: data.lostItemId,
    foundItemId: data.foundItemId,
    attempts: HANDOVER_CONFIG.MAX_ATTEMPTS,
  });

  log.warn(`Handover session ${matchId} blocked after ${HANDOVER_CONFIG.MAX_ATTEMPTS} attempts`);

  try {
    const [lostItemDoc, foundItemDoc] = await Promise.all([
      collections.items.doc(data.lostItemId).get(),
      collections.items.doc(data.foundItemId).get(),
    ]);

    const lostItem = lostItemDoc.exists
      ? ({ id: lostItemDoc.id, ...lostItemDoc.data() } as Item)
      : null;
    const foundItem = foundItemDoc.exists
      ? ({ id: foundItemDoc.id, ...foundItemDoc.data() } as Item)
      : null;

    const itemName = lostItem?.name || foundItem?.name || 'your item';

    const [lostEmail, foundEmail, adminEmails] = await Promise.all([
      lostItem ? resolveReporterEmail(lostItem) : undefined,
      foundItem ? resolveReporterEmail(foundItem) : undefined,
      loadAdminEmails(),
    ]);

    const recipients = [lostEmail, foundEmail, ...adminEmails].filter((value): value is string =>
      Boolean(value),
    );

    await Promise.all(
      recipients.map((recipient) =>
        sendHandoverBlockedNotice(recipient, itemName, HANDOVER_CONFIG.MAX_ATTEMPTS),
      ),
    );
  } catch (error) {
    log.error(`Failed to send handover blocked notices for match ${matchId}`, error);
  }
}

async function loadAdminEmails(): Promise<string[]> {
  const snapshot = await collections.users
    .where('role', '==', 'admin')
    .limit(ADMIN_NOTIFY_LIMIT)
    .get();

  return snapshot.docs
    .map((doc) => doc.data()?.email)
    .filter((email): email is string => typeof email === 'string' && email.length > 0);
}

/**
 * Get the status of a handover session.
 */
export async function getHandoverStatus(matchId: string) {
  const codeRef = await resolveCodeRef(matchId);
  const codeDoc = await codeRef.get();

  if (!codeDoc.exists) return null;

  const data = codeDoc.data() as HandoverCode;
  const expiresAt = toDate(data.expiresAt);

  return {
    status: data.status,
    attempts: data.attempts ?? 0,
    maxAttempts: HANDOVER_CONFIG.MAX_ATTEMPTS,
    expiresAt,
  };
}

export { HANDOVER_CONFIG };
