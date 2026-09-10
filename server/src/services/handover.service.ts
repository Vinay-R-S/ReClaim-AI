import crypto from 'crypto';
import { handoverRepository } from '../repositories/handover.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import { Item } from '../types/index.js';
import { HandoverCode, HandoverCodeHashVersion } from '../types/handover.js';
import {
  sendHandoverCodeToLostPerson,
  sendHandoverLinkToFoundPerson,
  sendHandoverBlockedNotice,
} from './email.service.js';
import { HANDOVER_CONFIG, toDate, validateHandoverCriteria } from './handover.criteria.js';
import { handoverMachine, stateOf } from './handover/handover.machine.js';
import { acceptsCode, type HandoverState } from './handover/handover.states.js';
import { issueQrToken, looksLikeQrToken, verifyQrToken } from './handover/handover.qr.js';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';

const log = createLogger('handover');

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

async function writeAuditEntry(
  action: string,
  matchId: string,
  actorId: string | undefined,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await handoverRepository.writeAudit({
      action,
      matchId,
      actorId: actorId || null,
      details,
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
  return handoverRepository.resolveCodeRef(matchId, toDate);
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
    const pair = await handoverRepository.loadPairForInitiate(lostItemId, foundItemId);

    if (!pair.lostItem || !pair.foundItem) {
      return { success: false, message: 'Items not found' };
    }

    const { lostItem, foundItem } = pair;

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

    const { result: issue, outcome } = await handoverMachine.decide<IssueOutcome>(
      codeRef,
      matchId,
      (data, from) => {
        const existing = data as unknown as HandoverCode | undefined;

        // Refused with a reason of their own, ahead of the table, so the caller
        // can say which of the two it was. The table refuses both anyway:
        // neither `verified` nor `completed` has an `issue_code` edge, and
        // `blocked` has only `reissue_code`. That is defect LOG-11 made
        // structural rather than guarded — no code path added later can reopen
        // a blocked session by accident, because there is no edge to take.
        // `completed` is final. `verified` is not: the saga can exhaust its
        // retries and escalate, and a session left verified with no handover
        // record behind it would otherwise be stranded with no way back —
        // invisible to the admin list and refused by this endpoint. The table
        // has the edge for exactly that, and only an admin re-issue takes it.
        if (from === 'completed' || (from === 'verified' && !options.reissueBlocked)) {
          return { kind: 'refuse', result: { kind: 'already_completed' } };
        }

        if (from === 'blocked' && !options.reissueBlocked) {
          return { kind: 'refuse', result: { kind: 'blocked' } };
        }

        // An admin re-issue clears the attempt budget; a plain re-trigger of an
        // open session keeps it, so re-running matching cannot hand out fresh
        // guesses to whoever is grinding the code.
        const carriedAttempts = existing && !options.reissueBlocked ? (existing.attempts ?? 0) : 0;

        const patch: Record<string, unknown> = {
          matchId,
          lostItemId,
          foundItemId,
          codeHash: hashCode(code, CURRENT_HASH_VERSION),
          codeHashVersion: CURRENT_HASH_VERSION,
          attempts: carriedAttempts,
          expiresAt: Timestamp.fromDate(expiresAt),
          issuedAt: Timestamp.now(),

          // Clear whatever a previous round left behind, so a re-issued session
          // does not inherit a stale terminal marker or an old override.
          //
          // `lastAttemptAt` survives a plain re-trigger, because the backoff is
          // measured from it and the attempts it applies to are deliberately
          // carried. Deleting it while keeping `attempts` cancelled the wait
          // those attempts were supposed to have earned, so a re-triggered
          // match run handed the next guess back immediately.
          ...(options.reissueBlocked ? { lastAttemptAt: FieldValue.delete() } : {}),
          presentedAt: FieldValue.delete(),
          blockedAt: FieldValue.delete(),
          expiredAt: FieldValue.delete(),
          verifiedAt: FieldValue.delete(),
          completionError: FieldValue.delete(),
          ...(overridden
            ? {
                criteriaOverrideBy: options.actorId || 'unknown',
                criteriaOverrideReason: options.overrideReason || null,
                criteriaFailure: criteriaFailure as string,
              }
            : {
                criteriaOverrideBy: FieldValue.delete(),
                criteriaOverrideReason: FieldValue.delete(),
                criteriaFailure: FieldValue.delete(),
              }),
        };

        return {
          kind: 'transition',
          plan: {
            transition: options.reissueBlocked ? 'reissue_code' : 'issue_code',
            actor: options.actorId ?? null,
            actorRole: options.actorId ? 'admin' : 'system',
            reason: options.reissueBlocked ? 'an admin re-issued the code' : 'code issued',
            metadata: {
              carriedAttempts,
              ...(overridden ? { criteriaFailure } : {}),
            },
            patch,
          },
          result: {
            kind: 'issued',
            previousStatus: existing?.status ?? null,
            previousAttempts: existing?.attempts ?? 0,
            hadExisting: Boolean(data),
          },
        };
      },
    );

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

    if (!outcome.ok) {
      // The table refused a move the checks above did not anticipate, which is
      // the machine doing its job rather than a bug to route around.
      log.warn(`Handover ${matchId} could not be issued from state ${outcome.from}`);

      return { success: false, message: 'This handover cannot be re-opened in its current state' };
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

  const user = await userRepository.findById(item.reportedBy);

  return user?.email;
}
/**
 * What one verification attempt decided.
 *
 * Every one of these is worked out inside the same transaction that writes the
 * transition, which is what stops parallel guesses each reading `attempts: 2`
 * and collectively spending more than the cap (defect LOG-13).
 */
type VerifyResult =
  | { kind: 'not_found' }
  | { kind: 'not_live'; state: HandoverState }
  | { kind: 'expired' }
  | { kind: 'too_soon'; retryAfterMs: number }
  | { kind: 'presented' }
  | { kind: 'already_presented' }
  | { kind: 'accepted' }
  | { kind: 'invalid'; attemptsLeft: number }
  | { kind: 'now_blocked'; data: HandoverCode };

/**
 * How long to make somebody wait after a failed attempt.
 *
 * Doubling from the configured base. Three attempts against a fresh session is
 * not the only way to spend a million codes: a caller who can get sessions
 * re-issued gets three more each time, and without a delay those three cost
 * nothing but the round trip.
 */
export function attemptBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;

  return env.handover.attemptBackoffMs * 2 ** (attempts - 1);
}

/** Whether the credential presented matches, whichever kind it is. */
function credentialMatches(credential: string, matchId: string, stored: HandoverCode): boolean {
  if (looksLikeQrToken(credential)) return verifyQrToken(credential, matchId).ok;

  return codeMatches(credential, stored);
}

/**
 * Verify a handover credential: six digits, or a scanned QR token.
 *
 * The transaction decides everything and writes one transition. What it does
 * not do is any of the five side effects of a completed handover: those hang
 * off the `handover.verified` event written in the same commit, so a failure
 * in any of them cannot leave the verification half applied (section 10.2).
 */
export async function verifyHandoverCode(
  matchId: string,
  credential: string,
): Promise<{ success: boolean; message: string; attemptsLeft?: number; retryAfterMs?: number }> {
  try {
    const codeRef = await resolveCodeRef(matchId);
    const now = new Date();

    const { result, outcome } = await handoverMachine.decide<VerifyResult>(
      codeRef,
      matchId,
      (data, from) => {
        if (!data) return { kind: 'refuse', result: { kind: 'not_found' } };

        const stored = data as unknown as HandoverCode;

        if (!acceptsCode(from)) {
          return { kind: 'refuse', result: { kind: 'not_live', state: from } };
        }

        const expiresAt = toDate(stored.expiresAt);

        if (!expiresAt || expiresAt < now) {
          return {
            kind: 'transition',
            plan: {
              transition: 'expire',
              actor: null,
              actorRole: 'system',
              reason: 'the code outlived its expiry',
              patch: { expiredAt: FieldValue.serverTimestamp() },
            },
            result: { kind: 'expired' },
          };
        }

        const attempts = stored.attempts ?? 0;
        const lastAttemptAt = toDate((stored as { lastAttemptAt?: unknown }).lastAttemptAt);
        const waitUntil = lastAttemptAt ? lastAttemptAt.getTime() + attemptBackoffMs(attempts) : 0;

        if (waitUntil > now.getTime()) {
          return {
            kind: 'refuse',
            result: { kind: 'too_soon', retryAfterMs: waitUntil - now.getTime() },
          };
        }

        if (credentialMatches(credential, matchId, stored)) {
          // With two-party confirmation on, this endpoint can never finish a
          // handover. Presenting the credential says the two have met; only
          // `confirmHandoverReceipt`, which is authenticated as the other
          // party, says the item changed hands.
          //
          // The `from` test used to be `=== 'code_issued'`, which meant a
          // second submission of the same credential arrived with the session
          // already at `awaiting_meet`, fell past this branch and confirmed
          // itself. That is the entire two-party guarantee lost to one
          // unauthenticated request being sent twice.
          if (env.handover.twoParty) {
            if (from === 'awaiting_meet') {
              return { kind: 'refuse', result: { kind: 'already_presented' } };
            }

            return {
              kind: 'transition',
              plan: {
                transition: 'present_code',
                actor: null,
                // Nobody here is authenticated: the credential is the owner's
                // secret and the link is the finder's, so who typed it is not
                // known. Recording a party would be a guess in the one log a
                // dispute is resolved from.
                actorRole: 'system',
                reason: 'credential accepted, waiting for the other party to confirm receipt',
                metadata: { credential: looksLikeQrToken(credential) ? 'qr' : 'code' },
                patch: { presentedAt: FieldValue.serverTimestamp() },
              },
              result: { kind: 'presented' },
            };
          }

          return {
            kind: 'transition',
            plan: {
              transition: 'confirm_receipt',
              actor: null,
              actorRole: 'system',
              reason: 'credential accepted',
              metadata: { credential: looksLikeQrToken(credential) ? 'qr' : 'code' },
              patch: { verifiedAt: FieldValue.serverTimestamp() },
              // The fact, written in the same commit as the transition.
              // Nothing else about completion happens inline.
              publish: {
                name: 'handover.verified',
                payload: {
                  handoverId: matchId,
                  lostItemId: stored.lostItemId,
                  foundItemId: stored.foundItemId,
                },
              },
            },
            result: { kind: 'accepted' },
          };
        }

        const newAttempts = attempts + 1;

        if (newAttempts >= HANDOVER_CONFIG.MAX_ATTEMPTS) {
          return {
            kind: 'transition',
            plan: {
              transition: 'block',
              actor: null,
              actorRole: 'system',
              reason: 'the attempt cap was reached',
              patch: {
                attempts: newAttempts,
                lastAttemptAt: FieldValue.serverTimestamp(),
                blockedAt: FieldValue.serverTimestamp(),
              },
            },
            result: { kind: 'now_blocked', data: stored },
          };
        }

        return {
          kind: 'transition',
          plan: {
            transition: 'fail_attempt',
            actor: null,
            actorRole: 'system',
            reason: 'the credential did not match',
            patch: { attempts: newAttempts, lastAttemptAt: FieldValue.serverTimestamp() },
          },
          result: {
            kind: 'invalid',
            attemptsLeft: HANDOVER_CONFIG.MAX_ATTEMPTS - newAttempts,
          },
        };
      },
    );

    // A decider that chose a transition the table refused wrote nothing, so
    // reporting its intended answer would claim a handover that did not
    // happen and, for `now_blocked`, email both parties and every admin about
    // a block that was never recorded. Unreachable while the guards and the
    // table agree, which is exactly the coupling the machine exists to remove.
    if (!outcome.ok && result.kind !== 'not_found' && result.kind !== 'not_live') {
      const expectedRefusal = result.kind === 'too_soon' || result.kind === 'already_presented';

      if (!expectedRefusal) {
        log.error('Verification decided a transition the table refused', {
          matchId,
          from: outcome.from,
          decided: result.kind,
        });

        return { success: false, message: 'Verification failed' };
      }
    }

    switch (result.kind) {
      case 'not_found':
        return { success: false, message: 'Handover session not found' };

      case 'not_live':
        return notLiveMessage(result.state);

      case 'expired':
        return { success: false, message: 'Code expired' };

      case 'too_soon':
        return {
          success: false,
          message: 'Too many attempts in a row. Wait a moment and try again.',
          retryAfterMs: result.retryAfterMs,
        };

      case 'invalid':
        return { success: false, message: 'Invalid code', attemptsLeft: result.attemptsLeft };

      case 'now_blocked':
        await onSessionBlocked(matchId, result.data);

        return {
          success: false,
          message: 'Too many failed attempts. Verification blocked.',
          attemptsLeft: 0,
        };

      case 'presented':
        return {
          success: true,
          message: 'Code accepted. Waiting for the other party to confirm the handover.',
        };

      case 'already_presented':
        return {
          success: true,
          message:
            'This code has already been accepted. The handover completes once the other party confirms.',
        };

      case 'accepted':
        return { success: true, message: 'Verification successful! Item handed over.' };

      default:
        return { success: false, message: 'Verification failed' };
    }
  } catch (error) {
    log.error('Verify Error:', error);

    return { success: false, message: 'Verification failed' };
  }
}

/** What to tell somebody presenting a code against a session that is not live. */
function notLiveMessage(state: HandoverState): {
  success: boolean;
  message: string;
  attemptsLeft?: number;
} {
  switch (state) {
    case 'blocked':
      return {
        success: false,
        message: 'This handover is blocked due to excessive failed attempts.',
        attemptsLeft: 0,
      };
    case 'expired':
      return { success: false, message: 'Code expired' };
    case 'verified':
    case 'completed':
      return { success: true, message: 'Already verified' };
    case 'cancelled':
      return { success: false, message: 'This handover was cancelled' };
    case 'disputed':
      return { success: false, message: 'This handover is under review' };
    default:
      return { success: false, message: 'This handover is not accepting a code' };
  }
}

/**
 * The second party confirms the handover (PLAN.md 10.4, two-party).
 *
 * The only place a handover is closed when two-party confirmation is on, and
 * the caller is authenticated as the person who reported the found item. The
 * credential was emailed to the other side, so the two halves are held by two
 * different people and neither can finish alone.
 *
 * With `HANDOVER_TWO_PARTY` off nothing reaches this: verification goes
 * straight to `verified` and there is no `awaiting_meet` to confirm from.
 */
export async function confirmHandoverReceipt(
  matchId: string,
  actorId: string,
  actorRole: 'finder' | 'admin',
): Promise<HandoverResult> {
  const codeRef = await resolveCodeRef(matchId);

  const { result, outcome } = await handoverMachine.decide<HandoverCode | null>(
    codeRef,
    matchId,
    (data, from) => {
      if (!data) return { kind: 'refuse', result: null };

      const stored = data as unknown as HandoverCode;

      if (from !== 'awaiting_meet') return { kind: 'refuse', result: stored };

      return {
        kind: 'transition',
        plan: {
          transition: 'confirm_receipt',
          actor: actorId,
          actorRole,
          reason: 'the second party confirmed the handover',
          patch: { verifiedAt: FieldValue.serverTimestamp() },
          publish: {
            name: 'handover.verified',
            payload: {
              handoverId: matchId,
              lostItemId: stored.lostItemId,
              foundItemId: stored.foundItemId,
            },
          },
        },
        result: stored,
      };
    },
  );

  if (outcome.ok) return { success: true, message: 'Receipt confirmed. Handover complete.' };

  if (!result) return { success: false, message: 'Handover session not found' };

  return {
    success: false,
    message:
      outcome.from === 'code_issued'
        ? 'The code has not been presented yet, so there is nothing to confirm'
        : 'This handover is not waiting for a confirmation',
  };
}

/**
 * A QR token for the owner to show.
 *
 * Only for a session still accepting a credential: minting one for a blocked
 * or completed handover would hand out something that looks like a way in and
 * is not.
 */
export async function issueHandoverQr(
  matchId: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const codeRef = await resolveCodeRef(matchId);
  const snapshot = await codeRef.get();

  if (!snapshot.exists) return null;
  if (!acceptsCode(stateOf(snapshot.data() as Record<string, unknown>))) return null;

  return issueQrToken(matchId);
}

async function onSessionBlocked(matchId: string, data: HandoverCode): Promise<void> {
  await writeAuditEntry('session_blocked', matchId, undefined, {
    lostItemId: data.lostItemId,
    foundItemId: data.foundItemId,
    attempts: HANDOVER_CONFIG.MAX_ATTEMPTS,
  });

  log.warn(`Handover session ${matchId} blocked after ${HANDOVER_CONFIG.MAX_ATTEMPTS} attempts`);

  try {
    const { lostItem, foundItem } = await handoverRepository.loadSessionItems(
      data.lostItemId,
      data.foundItemId,
    );

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
  return userRepository.listAdminEmails(ADMIN_NOTIFY_LIMIT);
}

/**
 * Get the status of a handover session.
 */
export async function getHandoverStatus(matchId: string) {
  const codeRef = await resolveCodeRef(matchId);
  const codeDoc = await codeRef.get();

  if (!codeDoc.exists) return null;

  const raw = codeDoc.data() as Record<string, unknown>;
  const data = raw as unknown as HandoverCode;
  const expiresAt = toDate(data.expiresAt);
  const attempts = data.attempts ?? 0;
  const lastAttemptAt = toDate(raw.lastAttemptAt);

  // What the page has always read, plus the machine's own state. `status` is
  // the projection of `state` through the four values that existed before the
  // event log, so a client that has not been updated keeps working.
  return {
    status: data.status,
    state: stateOf(raw),
    attempts,
    maxAttempts: HANDOVER_CONFIG.MAX_ATTEMPTS,
    expiresAt,
    /** Milliseconds until another attempt is accepted. Zero when one is. */
    retryAfterMs: lastAttemptAt
      ? Math.max(0, lastAttemptAt.getTime() + attemptBackoffMs(attempts) - Date.now())
      : 0,
    /** True when the finder has presented the code and the owner has not confirmed. */
    awaitingConfirmation: stateOf(raw) === 'awaiting_meet',
  };
}

/** The event log for one handover, for the admin timeline and a dispute. */
export async function getHandoverHistory(matchId: string) {
  return handoverMachine.history(matchId);
}

// Both live in `handover.criteria.ts`, which is where a caller should take
// them from. Re-exported only because this module's own signatures reference
// them; nothing else imports them from here.
export { HANDOVER_CONFIG, validateHandoverCriteria };
