/**
 * One-off item lifecycle migration. Run this BEFORE deploying the phase 9 server.
 *
 * It does two things.
 *
 * 1. Renames `collectionLocation` to `collectionPoint`.
 *
 * The report form has always sent `collectionLocation` and the create route
 * persisted it under that name, while every consumer reads `collectionPoint`:
 * the handover email to the owner (`handover.service.ts`), the handover record,
 * and the admin Handovers screen. The result was an email showing the found-at
 * location instead of the collection point, and an admin screen that never
 * showed one at all. The server now writes `collectionPoint`; this moves the
 * value on existing documents so existing items stop reading as blank.
 *
 * 2. Converts the `Resolved` item status to `Claimed`.
 *
 * Two flows closed the same real-world event with different terminal states:
 * the verification agent set `Resolved`, the handover flow set `Claimed`. Every
 * dashboard counts `Claimed`, so anything closed through verification vanished
 * from the metrics. `Resolved` is retired and both paths now set `Claimed`.
 *
 * Usage, from the `server` directory with a populated `.env`:
 *
 *   npm run migrate:items            # dry run, prints the plan and changes nothing
 *   npm run migrate:items -- --apply # writes
 *
 * Safe to run more than once: both passes select only documents that still need
 * changing, so a second run reports nothing to do.
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** Firestore refuses batches larger than this. */
const BATCH_LIMIT = 400;

type Db = Awaited<typeof import('../src/utils/firebase-admin.js')>['db'];

interface RenamePlan {
  itemId: string;
  value: string;
  hasCanonical: boolean;
}

interface StatusPlan {
  itemId: string;
  name: string;
}

/**
 * Pass 1: move `collectionLocation` onto `collectionPoint`.
 */
async function renameCollectionPoint(db: Db, apply: boolean): Promise<void> {
  console.log('=== Pass 1: collectionLocation -> collectionPoint ===\n');

  const items = await db.collection('items').get();
  const plans: RenamePlan[] = [];

  for (const doc of items.docs) {
    const data = doc.data();
    const legacy = data.collectionLocation;

    if (typeof legacy !== 'string' || legacy.trim() === '') continue;

    plans.push({
      itemId: doc.id,
      value: legacy,
      hasCanonical: typeof data.collectionPoint === 'string' && data.collectionPoint.trim() !== '',
    });
  }

  if (plans.length === 0) {
    console.log('No item carries a legacy collectionLocation.\n');
    return;
  }

  for (const plan of plans) {
    // A document that already has both keeps its canonical value: the server
    // has been writing that one, so it is the newer of the two.
    const action = plan.hasCanonical ? 'drop legacy field (canonical wins)' : 'copy to canonical';
    console.log(`${plan.itemId}  "${plan.value}"  ${action}`);
  }

  console.log(`\n${plans.length} item(s) to update.`);

  if (!apply) return;

  const { FieldValue } = await import('firebase-admin/firestore');

  for (let index = 0; index < plans.length; index += BATCH_LIMIT) {
    const batch = db.batch();

    for (const plan of plans.slice(index, index + BATCH_LIMIT)) {
      batch.update(db.collection('items').doc(plan.itemId), {
        ...(plan.hasCanonical ? {} : { collectionPoint: plan.value }),
        collectionLocation: FieldValue.delete(),
      });
    }

    await batch.commit();
  }

  console.log(`Updated ${plans.length} item(s).\n`);
}

/**
 * Pass 2: `Resolved` becomes `Claimed`.
 */
async function convertResolvedStatus(db: Db, apply: boolean): Promise<void> {
  console.log('=== Pass 2: status Resolved -> Claimed ===\n');

  const items = await db.collection('items').where('status', '==', 'Resolved').get();

  if (items.empty) {
    console.log('No item is in the retired Resolved state.\n');
    return;
  }

  const plans: StatusPlan[] = items.docs.map((doc) => ({
    itemId: doc.id,
    name: (doc.data().name as string | undefined) ?? '(unnamed)',
  }));

  for (const plan of plans) {
    console.log(`${plan.itemId}  ${plan.name}  Resolved -> Claimed`);
  }

  console.log(`\n${plans.length} item(s) to convert.`);

  if (!apply) return;

  const { FieldValue } = await import('firebase-admin/firestore');

  for (let index = 0; index < plans.length; index += BATCH_LIMIT) {
    const batch = db.batch();

    for (const plan of plans.slice(index, index + BATCH_LIMIT)) {
      batch.update(db.collection('items').doc(plan.itemId), {
        status: 'Claimed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
  }

  console.log(`Converted ${plans.length} item(s).\n`);
}

async function main() {
  const apply = process.argv.includes('--apply');

  if (!apply) {
    console.log('DRY RUN. Nothing will be written. Re-run with --apply to commit.\n');
  }

  // Imported after dotenv, because the config module parses process.env on import.
  const { db } = await import('../src/utils/firebase-admin.js');

  await renameCollectionPoint(db, apply);
  await convertResolvedStatus(db, apply);

  if (apply) {
    console.log('Done. Check a Found item and the admin Handovers screen.');
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
