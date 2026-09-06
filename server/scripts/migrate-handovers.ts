/**
 * One-off handover migration. Run this BEFORE deploying the phase 16 server.
 *
 * It backfills `participantIds: [lostPersonId, foundPersonId]` on every
 * completed handover.
 *
 * "The handovers this person took part in" used to be a read of every
 * completed handover followed by an in-memory filter on two nested objects,
 * because the two people were only stored inside `lostPersonDetails` and
 * `foundPersonDetails` and Firestore cannot index into those for a match on
 * either (defect PERF-03). The array makes it one `array-contains` query.
 *
 * The server writes the field on new handovers and falls back to the old scan
 * for records without it, so this is not a hard prerequisite; it is what lets
 * that fallback stop being needed.
 *
 * Usage, from the `server` directory with a populated `.env`:
 *
 *   npm run migrate:handovers            # dry run, prints the plan and changes nothing
 *   npm run migrate:handovers -- --apply # writes
 *
 * Safe to run more than once: it selects only documents that still need the
 * field, so a second run reports nothing to do.
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** Firestore refuses batches larger than this. */
const BATCH_LIMIT = 400;

interface BackfillPlan {
  handoverId: string;
  participantIds: string[];
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { db, collections } = await import('../src/utils/firebase-admin.js');

  const snapshot = await collections.handovers.get();

  const plans: BackfillPlan[] = [];
  let alreadyDone = 0;
  let noParticipants = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as {
      participantIds?: unknown;
      lostPersonId?: string | null;
      foundPersonId?: string | null;
      lostPersonDetails?: { userId?: string | null };
      foundPersonDetails?: { userId?: string | null };
    };

    if (Array.isArray(data.participantIds)) {
      alreadyDone += 1;
      continue;
    }

    // The top-level ids and the snapshots are written from the same value, but
    // older records only have one or the other.
    const candidates = [
      data.lostPersonId ?? data.lostPersonDetails?.userId,
      data.foundPersonId ?? data.foundPersonDetails?.userId,
    ];

    const participantIds = [
      ...new Set(candidates.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ];

    // A handover whose items were both deleted before this ran has nobody to
    // list. Writing an empty array is still worth it: it stops the fallback
    // scan considering the record every time somebody opens their list.
    if (participantIds.length === 0) noParticipants += 1;

    plans.push({ handoverId: doc.id, participantIds });
  }

  console.log(`Handovers scanned:        ${snapshot.size}`);
  console.log(`Already carrying the field: ${alreadyDone}`);
  console.log(`To backfill:              ${plans.length}`);
  console.log(`  of which have no participants: ${noParticipants}`);

  if (plans.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  if (!apply) {
    console.log('\nDry run. Re-run with -- --apply to write.');
    for (const plan of plans.slice(0, 10)) {
      console.log(`  ${plan.handoverId} -> [${plan.participantIds.join(', ')}]`);
    }
    if (plans.length > 10) console.log(`  ... and ${plans.length - 10} more`);
    return;
  }

  let written = 0;

  for (let start = 0; start < plans.length; start += BATCH_LIMIT) {
    const batch = db.batch();

    for (const plan of plans.slice(start, start + BATCH_LIMIT)) {
      batch.update(collections.handovers.doc(plan.handoverId), {
        participantIds: plan.participantIds,
      });
      written += 1;
    }

    await batch.commit();
  }

  console.log(`\nBackfilled ${written} handovers.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
