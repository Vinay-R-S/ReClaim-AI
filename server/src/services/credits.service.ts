/**
 * Credits Service - the single write path for user credit balances
 *
 * There is one store: `users/{uid}.credits` is the balance and
 * `creditTransactions` is the ledger. Both are written in one transaction, so a
 * balance can never move without a ledger entry explaining it, and a retry can
 * never double-apply an award (defect LOG-01).
 *
 * The `credits/{uid}` collection this project used to write is retired; see
 * `scripts/migrate-credits.ts` for the reconciliation.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { creditRepository } from '../repositories/credit.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { CREDIT_VALUES, CreditTransaction } from '../types/index.js';
import { sendCreditsNotification } from './email.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('credits');

export type CreditReason = keyof typeof CREDIT_VALUES;

type LedgerReason = CreditTransaction['reason'];

const REASON_DESCRIPTIONS: Record<CreditReason, string> = {
  SIGNUP_BONUS: 'Welcome bonus for joining ReClaim AI',
  REPORT_FOUND: 'Reporting a found item',
  SUCCESSFUL_MATCH_FINDER: 'Your found item was claimed successfully',
  SUCCESSFUL_MATCH_OWNER: 'Successfully claiming your lost item',
  FALSE_CLAIM: 'False claim penalty',
};

export interface CreditResult {
  success: boolean;
  /** Balance after the write, or the current balance when nothing was applied. */
  newBalance: number;
  amount: number;
  /** True when an idempotency key matched an entry that already existed. */
  alreadyApplied: boolean;
}

interface ApplyOptions {
  relatedItemId?: string;
  /**
   * Ledger document id. Supplying one makes the write exactly-once: a second
   * call with the same key is a no-op. Omit it for adjustments that are
   * legitimately repeatable, such as a manual admin correction.
   */
  idempotencyKey?: string;
  /** Free text for a manual adjustment, stored on the ledger entry. */
  note?: string;
  /** Extra fields merged into the user document in the same transaction. */
  userPatch?: Record<string, unknown>;
  sendNotification?: boolean;
}

/**
 * `CREDIT_VALUES` keys are the uppercase form of the ledger reason values.
 */
function toLedgerReason(reason: CreditReason): LedgerReason {
  return reason.toLowerCase() as LedgerReason;
}

/**
 * Build a stable ledger id for an award that must only ever land once
 */
export function creditKey(reason: CreditReason, userId: string, itemId?: string): string {
  const suffix = itemId ? `:${itemId}` : '';
  return `${toLedgerReason(reason)}:${userId}${suffix}`;
}

/**
 * Get a user's current balance
 */
export async function getUserCredits(userId: string): Promise<number> {
  try {
    const user = await userRepository.findById(userId);

    return user?.credits ?? 0;
  } catch (error) {
    log.error('Error getting user credits:', error);
    return 0;
  }
}

/**
 * Apply a credit delta and record it, atomically.
 *
 * The balance and the ledger entry are written in one transaction, and the user
 * document is written with merge so a profile with no `credits` field yet is
 * seeded rather than throwing. The previous implementation used `.update()`,
 * which throws when the document does not exist, and the error was swallowed
 * into `success: false`, so awards disappeared silently (LOG-18).
 */
export async function applyCredits(
  userId: string,
  reason: CreditReason,
  options: ApplyOptions = {},
): Promise<CreditResult> {
  const { relatedItemId, idempotencyKey, note, userPatch, sendNotification = true } = options;
  const amount = CREDIT_VALUES[reason];

  try {
    const userRef = creditRepository.userRef(userId);
    const ledgerRef = creditRepository.ledgerRef(idempotencyKey);

    const outcome = await creditRepository.runTransaction(async (tx) => {
      // Every read has to happen before any write in a Firestore transaction.
      const [userSnapshot, ledgerSnapshot] = await Promise.all([
        tx.get(userRef),
        tx.get(ledgerRef),
      ]);
      const current = (userSnapshot.data()?.credits as number | undefined) ?? 0;

      // A merge-set would otherwise create a `users/{uid}` document holding
      // nothing but a balance, from a stale `claimedBy` or `reportedBy` on a
      // deleted account. `authMiddleware` would then resolve a role from a
      // document that was never a profile.
      if (!userSnapshot.exists) {
        return {
          missing: true,
          applied: false,
          newBalance: 0,
          email: undefined as string | undefined,
        };
      }

      if (ledgerSnapshot.exists) {
        // Still apply the patch: it carries the flag that lets sign-in skip
        // this call, and skipping the write here would leave the flag
        // permanently absent once the ledger entry exists.
        if (userPatch) tx.set(userRef, userPatch, { merge: true });
        return {
          missing: false,
          applied: false,
          newBalance: current,
          email: undefined as string | undefined,
        };
      }

      const newBalance = current + amount;

      tx.set(
        userRef,
        { ...userPatch, credits: newBalance, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );

      tx.set(ledgerRef, {
        userId,
        amount,
        reason: toLedgerReason(reason),
        balanceAfter: newBalance,
        ...(relatedItemId ? { relatedItemId } : {}),
        ...(note ? { note } : {}),
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        missing: false,
        applied: true,
        newBalance,
        email: userSnapshot.data()?.email as string | undefined,
      };
    });

    if (outcome.missing) {
      log.error('Credit award skipped, no user document', { userId, reason });
      return { success: false, newBalance: 0, amount, alreadyApplied: false };
    }

    if (!outcome.applied) {
      log.debug('Credit award skipped, already recorded', { userId, reason });
      return { success: true, newBalance: outcome.newBalance, amount: 0, alreadyApplied: true };
    }

    log.info(
      `Credits updated for user ${userId}: ${amount > 0 ? '+' : ''}${amount}, new balance: ${outcome.newBalance}`,
    );

    // Outside the transaction: an email failure must not roll back the ledger.
    if (sendNotification && amount > 0 && outcome.email) {
      await sendCreditsNotification(
        outcome.email,
        amount,
        REASON_DESCRIPTIONS[reason],
        outcome.newBalance,
      );
    }

    return { success: true, newBalance: outcome.newBalance, amount, alreadyApplied: false };
  } catch (error) {
    log.error('Error updating credits:', error);
    return { success: false, newBalance: 0, amount, alreadyApplied: false };
  }
}

/**
 * Award the welcome bonus, once per account
 */
export async function awardSignupBonus(userId: string): Promise<CreditResult> {
  return applyCredits(userId, 'SIGNUP_BONUS', {
    idempotencyKey: creditKey('SIGNUP_BONUS', userId),
    // The flag is what lets sign-in skip this call entirely once it has landed,
    // so a returning user costs no extra transaction. The ledger entry is still
    // the authority.
    userPatch: { signupBonusAwarded: true },
    sendNotification: false,
  });
}

/**
 * Award the finder when a handover completes, once per item
 */
export async function awardFinderCredits(userId: string, itemId: string): Promise<CreditResult> {
  return applyCredits(userId, 'SUCCESSFUL_MATCH_FINDER', {
    relatedItemId: itemId,
    idempotencyKey: creditKey('SUCCESSFUL_MATCH_FINDER', userId, itemId),
  });
}

/**
 * Award the owner when a handover completes, once per item
 */
export async function awardOwnerCredits(userId: string, itemId: string): Promise<CreditResult> {
  return applyCredits(userId, 'SUCCESSFUL_MATCH_OWNER', {
    relatedItemId: itemId,
    idempotencyKey: creditKey('SUCCESSFUL_MATCH_OWNER', userId, itemId),
  });
}

/**
 * Deduct for a rejected claim.
 *
 * Deliberately not idempotent: an admin may reject the same user on the same
 * item more than once, and each rejection is its own penalty.
 */
export async function penalizeFalseClaim(userId: string, itemId: string): Promise<CreditResult> {
  return applyCredits(userId, 'FALSE_CLAIM', {
    relatedItemId: itemId,
    sendNotification: false,
  });
}

/**
 * Manual adjustment by an admin.
 *
 * Repeatable by design, so it carries no idempotency key and its own ledger
 * reason rather than borrowing one of the automatic ones.
 */
export async function adjustCredits(
  userId: string,
  amount: number,
  note?: string,
): Promise<CreditResult> {
  try {
    const userRef = creditRepository.userRef(userId);
    const ledgerRef = creditRepository.ledgerRef();

    const newBalance = await creditRepository.runTransaction(async (tx) => {
      const userSnapshot = await tx.get(userRef);

      if (!userSnapshot.exists) {
        throw new Error(`No user document for ${userId}`);
      }

      const current = (userSnapshot.data()?.credits as number | undefined) ?? 0;
      const next = current + amount;

      tx.set(userRef, { credits: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      tx.set(ledgerRef, {
        userId,
        amount,
        reason: 'manual_adjustment',
        balanceAfter: next,
        note: note || 'Manual adjustment',
        createdAt: FieldValue.serverTimestamp(),
      });

      return next;
    });

    log.info(`Credits adjusted for user ${userId}: ${amount > 0 ? '+' : ''}${amount}`);

    return { success: true, newBalance, amount, alreadyApplied: false };
  } catch (error) {
    log.error('Error adjusting credits:', error);
    return { success: false, newBalance: 0, amount, alreadyApplied: false };
  }
}

/**
 * Get credit transaction history for a user
 */
export async function getCreditHistory(
  userId: string,
  limit: number = 10,
): Promise<CreditTransaction[]> {
  const base = creditRepository.historyQuery(userId);

  try {
    // Ordering has to happen in the query. Ledger ids are deterministic for the
    // awards that must land once, so they cluster by reason, and an unordered
    // query returns documents in id order: truncation would systematically drop
    // the same kinds of entry.
    const snapshot = await base.orderBy('createdAt', 'desc').limit(limit).get();
    return toTransactions(snapshot.docs);
  } catch (error) {
    // The composite index ships in `firestore.indexes.json` but is only live
    // once `firebase deploy` has run, so fall back rather than showing nothing.
    log.warn(
      'Ordered credit history failed, falling back to an in-memory sort. Deploy the creditTransactions (userId, createdAt) index.',
      { error },
    );

    const snapshot = await base.limit(Math.max(limit * 2, 100)).get();
    return toTransactions(snapshot.docs)
      .sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime())
      .slice(0, limit);
  }
}

function toTransactions(docs: FirebaseFirestore.QueryDocumentSnapshot[]): CreditTransaction[] {
  return docs.map((doc) => ({ id: doc.id, ...doc.data() })) as CreditTransaction[];
}

function toDate(value: Timestamp | undefined): Date {
  return value?.toDate?.() ?? new Date(0);
}
