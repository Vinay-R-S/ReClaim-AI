/**
 * One-off handover state migration, for phase 26.
 *
 * Backfills `state` and `sequence` on every `handoverCodes` document, and
 * seeds the event log with one event describing where each session already
 * was.
 *
 * The state machine reads a document with no `state` through
 * `fromLegacyStatus`, so the server runs correctly before this has been run:
 * `pending` reads as `code_issued`, a stored `verified` reads as `completed`,
 * and the rest map across unchanged. What the backfill buys is the log. Until
 * it exists, a session that was issued before the phase has no history, so the
 * admin timeline is empty for it and a dispute about it has nothing to read.
 *
 * The seeded event is honest about being a seed: its transition is recorded as
 * `issue_code` with the reason naming this migration, and `from` is null,
 * because nothing knows what the session's earlier states were. It is a
 * starting point for the log, not an invented history.
 *
 * Usage, from the `server` directory with a populated `.env`:
 *
 *   npm run migrate:handover-states            # dry run, prints the plan
 *   npm run migrate:handover-states -- --apply # writes
 *
 * Safe to run more than once: documents that already carry `state` are
 * skipped, so a second run reports nothing to do. Safe against a live
 * deployment too: each write is its own transaction that re-checks `state` at
 * commit time rather than trusting the scan.
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

interface StatePlan {
  docId: string;
  matchId: string;
  legacyStatus: string;
  state: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { db, collections } = await import('../src/utils/firebase-admin.js');
  const { fromLegacyStatus } = await import('../src/services/handover/handover.states.js');

  const snapshot = await collections.handoverCodes.get();

  const plans: StatePlan[] = [];
  let alreadyDone = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as { state?: unknown; status?: string; matchId?: string };

    if (typeof data.state === 'string') {
      alreadyDone += 1;
      continue;
    }

    plans.push({
      docId: doc.id,
      // Legacy documents carry a random id and name their match in a field;
      // documents written since phase 7 are keyed on the match id itself.
      matchId: data.matchId || doc.id,
      legacyStatus: data.status || 'pending',
      state: fromLegacyStatus(data.status),
    });
  }

  const counts = plans.reduce<Record<string, number>>((totals, plan) => {
    totals[plan.state] = (totals[plan.state] ?? 0) + 1;

    return totals;
  }, {});

  console.log(`Handover sessions:      ${snapshot.size}`);
  console.log(`Already carry a state:  ${alreadyDone}`);
  console.log(`To backfill:            ${plans.length}`);
  Object.entries(counts).forEach(([state, count]) => console.log(`  ${state}: ${count}`));

  if (!apply) {
    console.log('\nDry run. Nothing was written. Re-run with --apply to write.');
    return;
  }

  if (plans.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  let written = 0;
  let raced = 0;

  for (const plan of plans) {
    const codeRef = collections.handoverCodes.doc(plan.docId);
    const eventRef = collections.handoverEvents.doc(`${plan.matchId}:1`);

    const applied = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(codeRef);

      // Re-checked at commit time, not trusted from the scan. The server may
      // be running, and a real transition since the scan is the authority: a
      // plain batch would reset that session's state to whatever the legacy
      // status said and overwrite its first event with the seed, which is a
      // blocked session silently reopened and its evidence destroyed.
      if (!snapshot.exists) return false;
      if (typeof snapshot.data()?.state === 'string') return false;

      tx.set(codeRef, { state: plan.state, sequence: 1 }, { merge: true });

      // The same deterministic id the machine uses, so a re-run overwrites the
      // seed rather than adding a second one beside it.
      tx.set(eventRef, {
        handoverId: plan.matchId,
        from: null,
        to: plan.state,
        transition: 'issue_code',
        actor: null,
        actorRole: 'system',
        reason: `seeded by migrate-handover-states from status "${plan.legacyStatus}"`,
        metadata: { migrated: true, legacyStatus: plan.legacyStatus },
        sequence: 1,
        traceparent: '',
        at: new Date(),
      });

      return true;
    });

    if (applied) written += 1;
    else raced += 1;

    if ((written + raced) % 50 === 0) console.log(`Processed ${written + raced}/${plans.length}`);
  }

  console.log(`Wrote ${written}.`);

  if (raced > 0) {
    console.log(`Skipped ${raced} that gained a state after the scan. Re-run to confirm.`);
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
