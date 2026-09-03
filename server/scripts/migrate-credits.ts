/**
 * One-off credits migration. Run this BEFORE deploying the phase 6 server.
 *
 * It does two things.
 *
 * 1. Backfills the signup bonus.
 *
 * Every profile created before phase 6 was written with a literal `credits: 10`
 * and no ledger entry: first by the browser in `AuthContext`, later by the
 * `POST /api/auth/profile` route. The new server awards the bonus through the
 * ledger and skips it when a `signup_bonus:<uid>` entry exists. Without this
 * backfill every existing user is paid a second time on their next sign-in,
 * because nothing records that they already received it. The backfill writes the
 * missing ledger entry and the `signupBonusAwarded` flag, and does not touch the
 * balance, which already includes the bonus.
 *
 * 2. Reconciles the retired `credits/{uid}` collection.
 *
 * Two write paths existed. `services/credits.ts` moved `users/{uid}.credits`,
 * which is what every read uses, while the old `PUT /api/credits/:userId` wrote
 * a separate `credits/{uid}` document nothing ever read (defect LOG-01). Manual
 * admin adjustments therefore never reached the balance users see.
 *
 * The old endpoint seeded a missing document from `DEFAULT_CREDITS = 10` and
 * added each adjustment to the running value:
 *
 *   legacy.credits = 10 + sum(every adjustment ever applied to this user)
 *
 * so the amount that never reached the real balance is `legacy.credits - 10`.
 * Nothing else ever wrote that collection, so the derivation is exact.
 *
 * That old endpoint already wrote a `creditTransactions` row per adjustment, so
 * the ledger is complete and only the balance is behind. The reconciliation
 * therefore moves the balance and writes a ZERO-amount marker rather than an
 * entry for the delta: posting the delta again would double-count it against the
 * rows that are already there, and the ledger would stop summing to the balance.
 *
 * Usage, from the `server` directory with a populated `.env`:
 *
 *   npm run migrate:credits            # dry run, prints the plan and changes nothing
 *   npm run migrate:credits -- --apply # writes
 *
 * Safe to run more than once: both passes are keyed on a document id, so a
 * second run reports "already done" and writes nothing.
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const LEGACY_SEED = 10;
const SIGNUP_BONUS = 10;

interface BonusPlan {
  userId: string;
  balance: number;
  hasFlag: boolean;
  hasLedgerEntry: boolean;
}

interface ReconcilePlan {
  userId: string;
  legacyBalance: number;
  delta: number;
  currentBalance: number;
  newBalance: number;
  userExists: boolean;
  alreadyReconciled: boolean;
}

type Db = Awaited<typeof import('../src/utils/firebase-admin.js')>['db'];

/**
 * Pass 1: record the signup bonus every existing profile already received
 */
async function backfillSignupBonus(db: Db, apply: boolean): Promise<void> {
  console.log('=== Pass 1: signup bonus backfill ===\n');

  const users = await db.collection('users').get();

  if (users.empty) {
    console.log('No user documents.\n');
    return;
  }

  const plans: BonusPlan[] = [];

  for (const userDoc of users.docs) {
    const ledgerDoc = await db
      .collection('creditTransactions')
      .doc(`signup_bonus:${userDoc.id}`)
      .get();

    plans.push({
      userId: userDoc.id,
      balance: (userDoc.data().credits as number | undefined) ?? 0,
      hasFlag: userDoc.data().signupBonusAwarded === true,
      hasLedgerEntry: ledgerDoc.exists,
    });
  }

  const actionable = plans.filter((plan) => !plan.hasLedgerEntry || !plan.hasFlag);

  for (const plan of plans) {
    const state = plan.hasLedgerEntry && plan.hasFlag ? 'already recorded' : 'needs backfill';
    console.log(`${plan.userId}  balance=${plan.balance}  ${state}`);
  }

  console.log(`\n${actionable.length} of ${plans.length} profile(s) to backfill.`);

  if (!apply || actionable.length === 0) return;

  for (const plan of actionable) {
    const userRef = db.collection('users').doc(plan.userId);
    const ledgerRef = db.collection('creditTransactions').doc(`signup_bonus:${plan.userId}`);

    await db.runTransaction(async (tx) => {
      const [userSnapshot, ledgerSnapshot] = await Promise.all([
        tx.get(userRef),
        tx.get(ledgerRef),
      ]);

      if (!userSnapshot.exists) return;

      // The flag is always set. The ledger entry records the bonus that was
      // already granted, so the balance is left exactly as it is.
      tx.set(userRef, { signupBonusAwarded: true }, { merge: true });

      if (!ledgerSnapshot.exists) {
        tx.set(ledgerRef, {
          userId: plan.userId,
          amount: SIGNUP_BONUS,
          reason: 'signup_bonus',
          balanceAfter: (userSnapshot.data()?.credits as number | undefined) ?? 0,
          note: 'Backfilled: the bonus was granted before the ledger existed',
          createdAt: new Date(),
        });
      }
    });

    console.log(`Backfilled ${plan.userId}`);
  }

  console.log('');
}

/**
 * Pass 2: move the balance that the retired collection swallowed
 */
async function reconcileLegacyBalances(db: Db, apply: boolean): Promise<void> {
  console.log('=== Pass 2: legacy credits/{uid} reconciliation ===\n');

  const legacySnapshot = await db.collection('credits').get();

  if (legacySnapshot.empty) {
    console.log('No documents in the legacy `credits` collection. Nothing to reconcile.');
    console.log('The collection can be deleted in the Firebase console.\n');
    return;
  }

  console.log(`Found ${legacySnapshot.size} legacy credit document(s).\n`);

  const plans: ReconcilePlan[] = [];

  for (const legacyDoc of legacySnapshot.docs) {
    const userId = legacyDoc.id;
    const legacyBalance = (legacyDoc.data().credits as number | undefined) ?? 0;
    const delta = legacyBalance - LEGACY_SEED;

    const [userSnapshot, ledgerSnapshot] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('creditTransactions').doc(`reconciliation:${userId}`).get(),
    ]);

    const currentBalance = (userSnapshot.data()?.credits as number | undefined) ?? 0;

    plans.push({
      userId,
      legacyBalance,
      delta,
      currentBalance,
      newBalance: currentBalance + delta,
      userExists: userSnapshot.exists,
      alreadyReconciled: ledgerSnapshot.exists,
    });
  }

  for (const plan of plans) {
    const note = !plan.userExists
      ? 'SKIP, no user document'
      : plan.alreadyReconciled
        ? 'SKIP, already reconciled'
        : plan.delta === 0
          ? 'SKIP, no adjustment to carry over'
          : `${plan.currentBalance} -> ${plan.newBalance}`;

    console.log(
      `${plan.userId}  legacy=${plan.legacyBalance}  delta=${plan.delta >= 0 ? '+' : ''}${plan.delta}  ${note}`,
    );
  }

  const actionable = plans.filter(
    (plan) => plan.userExists && !plan.alreadyReconciled && plan.delta !== 0,
  );

  console.log(`\n${actionable.length} user(s) to reconcile.`);

  if (!apply) return;

  for (const plan of actionable) {
    const userRef = db.collection('users').doc(plan.userId);
    const ledgerRef = db.collection('creditTransactions').doc(`reconciliation:${plan.userId}`);

    await db.runTransaction(async (tx) => {
      const [userSnapshot, ledgerSnapshot] = await Promise.all([
        tx.get(userRef),
        tx.get(ledgerRef),
      ]);

      if (ledgerSnapshot.exists || !userSnapshot.exists) return;

      const current = (userSnapshot.data()?.credits as number | undefined) ?? 0;
      const next = current + plan.delta;

      tx.set(userRef, { credits: next }, { merge: true });

      // Zero amount on purpose. The individual adjustments are already in the
      // ledger from the old endpoint; this row exists to explain the balance
      // correction and to make the pass idempotent, not to restate them.
      tx.set(ledgerRef, {
        userId: plan.userId,
        amount: 0,
        reason: 'manual_adjustment',
        balanceAfter: next,
        note: `Balance corrected by ${plan.delta >= 0 ? '+' : ''}${plan.delta} to include adjustments that were written to the retired credits/${plan.userId} document (legacy balance ${plan.legacyBalance}). The adjustments themselves are already in this ledger.`,
        createdAt: new Date(),
      });
    });

    console.log(`Reconciled ${plan.userId}: ${plan.currentBalance} -> ${plan.newBalance}`);
  }

  console.log('');
}

async function main() {
  const apply = process.argv.includes('--apply');

  if (!apply) {
    console.log('DRY RUN. Nothing will be written. Re-run with --apply to commit.\n');
  }

  // Imported after dotenv, because the config module parses process.env on import.
  const { db } = await import('../src/utils/firebase-admin.js');

  await backfillSignupBonus(db, apply);
  await reconcileLegacyBalances(db, apply);

  if (apply) {
    console.log('Done. Verify balances, then delete the `credits` collection.');
    return;
  }

  console.log('Dry run complete. Re-run with --apply to write these changes.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
