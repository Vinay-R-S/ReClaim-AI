/**
 * The Firestore security rules, against the emulator.
 *
 * These rules are the only thing standing between a signed-in browser and the
 * data, and they have been tightened twice: phase 5 stopped the client writing
 * `role` and `credits` on its own profile, and phase 16 closed the item
 * collection entirely once nothing in the client read it any more. Neither
 * change had a test, so nothing would have noticed a rule going back.
 *
 * Run with `npm run test:rules`, which starts the emulator around them.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', '..', '..', 'firestore.rules');

const OWNER = 'user-owner';
const OTHER = 'user-other';
const ADMIN = 'user-admin';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'reclaim-rules-test',
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();

  // Seeded past the rules, the way the server writes them.
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', OWNER), { role: 'user', status: 'active', credits: 10 });
    await setDoc(doc(db, 'users', OTHER), { role: 'user', status: 'active', credits: 0 });
    await setDoc(doc(db, 'users', ADMIN), { role: 'admin', status: 'active', credits: 0 });
    await setDoc(doc(db, 'items', 'item-1'), { name: 'Wallet', reportedBy: OWNER });
    await setDoc(doc(db, 'matches', 'match-1'), { lostItemId: 'item-1' });
    await setDoc(doc(db, 'handovers', 'handover-1'), { matchId: 'match-1' });
    await setDoc(doc(db, 'handoverCodes', 'match-1'), { codeHash: 'x' });
    await setDoc(doc(db, 'settings', 'system'), { aiProvider: 'groq_only' });
    await setDoc(doc(db, 'settings', 'analytics'), { visitorCount: 1 });
  });
});

const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asOther = () => env.authenticatedContext(OTHER).firestore();
const asAdmin = () => env.authenticatedContext(ADMIN).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

describe('users', () => {
  it('lets a user read their own profile', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'users', OWNER)));
  });

  it('lets an admin read any profile', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'users', OWNER)));
  });

  it('refuses one user reading another profile', async () => {
    await assertFails(getDoc(doc(asOther(), 'users', OWNER)));
  });

  it('refuses an anonymous read', async () => {
    await assertFails(getDoc(doc(asAnon(), 'users', OWNER)));
  });

  /**
   * PERF-07: the users screen reads a paginated API endpoint. A browser that
   * can enumerate the collection is how it used to pull every account at once.
   */
  it('PERF-07 refuses to list the collection, even to an admin', async () => {
    await assertFails(getDocs(collection(asAdmin(), 'users')));
  });

  /**
   * SEC-17: the browser used to write this document itself, `role` included,
   * so anyone could self-assign `role: "admin"`.
   */
  it('SEC-17 refuses a user writing their own profile', async () => {
    await assertFails(updateDoc(doc(asOwner(), 'users', OWNER), { displayName: 'New name' }));
  });

  it('SEC-17 refuses a user granting themselves the admin role', async () => {
    await assertFails(updateDoc(doc(asOwner(), 'users', OWNER), { role: 'admin' }));
  });

  it('SEC-17 refuses a user setting their own balance', async () => {
    await assertFails(updateDoc(doc(asOwner(), 'users', OWNER), { credits: 9999 }));
  });

  it('refuses profile creation from the browser', async () => {
    await assertFails(setDoc(doc(asOwner(), 'users', 'brand-new'), { role: 'user' }));
  });

  it('refuses deletion, including by an admin', async () => {
    await assertFails(deleteDoc(doc(asAdmin(), 'users', OTHER)));
  });
});

describe('items', () => {
  /**
   * PERF-07: every screen goes through the API now, which is rate limited,
   * paginated and filtered by what the caller may see.
   */
  it('PERF-07 refuses a read, even to an admin', async () => {
    await assertFails(getDoc(doc(asAdmin(), 'items', 'item-1')));
    await assertFails(getDocs(collection(asAdmin(), 'items')));
  });

  it('refuses a read to the reporter of the item', async () => {
    await assertFails(getDoc(doc(asOwner(), 'items', 'item-1')));
  });

  it('refuses every write', async () => {
    await assertFails(setDoc(doc(asOwner(), 'items', 'new-item'), { name: 'Mine' }));
    await assertFails(updateDoc(doc(asOwner(), 'items', 'item-1'), { name: 'Renamed' }));
    await assertFails(deleteDoc(doc(asOwner(), 'items', 'item-1')));
    await assertFails(updateDoc(doc(asAdmin(), 'items', 'item-1'), { status: 'Claimed' }));
  });
});

describe('matches, handovers and the ledger', () => {
  it('lets an admin read matches and handovers', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'matches', 'match-1')));
    await assertSucceeds(getDoc(doc(asAdmin(), 'handovers', 'handover-1')));
  });

  it('refuses an ordinary user reading them', async () => {
    await assertFails(getDoc(doc(asOwner(), 'matches', 'match-1')));
    await assertFails(getDoc(doc(asOwner(), 'handovers', 'handover-1')));
  });

  it('refuses every write, including by an admin', async () => {
    await assertFails(updateDoc(doc(asAdmin(), 'matches', 'match-1'), { status: 'claimed' }));
    await assertFails(updateDoc(doc(asAdmin(), 'handovers', 'handover-1'), { status: 'x' }));
  });

  /**
   * The codes are hashed, but there is no reason for a browser to enumerate
   * them: a list of live sessions is a list of things to guess at.
   */
  it('refuses anyone reading a handover code, admin included', async () => {
    await assertFails(getDoc(doc(asAdmin(), 'handoverCodes', 'match-1')));
    await assertFails(getDoc(doc(asOwner(), 'handoverCodes', 'match-1')));
  });
});

describe('settings', () => {
  it('lets any signed-in user read the system settings', async () => {
    await assertSucceeds(getDoc(doc(asOwner(), 'settings', 'system')));
  });

  it('refuses an anonymous read', async () => {
    await assertFails(getDoc(doc(asAnon(), 'settings', 'system')));
  });

  it('keeps the visitor counter to admins', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'settings', 'analytics')));
    await assertFails(getDoc(doc(asOwner(), 'settings', 'analytics')));
  });

  it('refuses a write from the browser', async () => {
    await assertFails(updateDoc(doc(asAdmin(), 'settings', 'system'), { cctvEnabled: false }));
  });
});

describe('anything not named in the rules', () => {
  it('is closed', async () => {
    await assertFails(getDoc(doc(asAdmin(), 'somethingElse', 'doc-1')));
    await assertFails(setDoc(doc(asAdmin(), 'somethingElse', 'doc-1'), { a: 1 }));
  });
});
