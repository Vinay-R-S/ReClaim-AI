/**
 * Credits, against an in-memory Firestore.
 *
 * The transaction is the thing worth testing: a balance and its ledger entry
 * are written together or not at all, and an award that must land once has a
 * deterministic ledger id so a replay is a read rather than a second payment.
 * Several of these are named after the defect they close, so a fix cannot
 * silently revert.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A document in the fake store. */
type Doc = Record<string, unknown>;

/** `collection/id`, which is all a ref needs to be here. */
interface FakeRef {
  path: string;
}

const store = new Map<string, Doc>();

/**
 * Enough of a Firestore transaction to exercise the real code path.
 *
 * Writes apply immediately rather than at commit, which is the one way this
 * differs from the real thing. The code under test never reads back a value it
 * wrote in the same transaction, so that difference is not observable.
 */
const fakeRepository = {
  userRef: (userId: string): FakeRef => ({ path: `users/${userId}` }),
  ledgerRef: (key?: string): FakeRef => ({
    path: `creditTransactions/${key ?? `auto-${Math.random()}`}`,
  }),
  historyQuery: vi.fn(),
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const tx = {
      get: async (ref: FakeRef) => ({
        exists: store.has(ref.path),
        data: () => store.get(ref.path),
      }),
      set: (ref: FakeRef, data: Doc, options?: { merge?: boolean }) => {
        store.set(ref.path, options?.merge ? { ...(store.get(ref.path) ?? {}), ...data } : data);
      },
    };

    return fn(tx);
  },
};

vi.mock('../repositories/credit.repository.js', () => ({
  creditRepository: fakeRepository,
  CreditRepository: class {},
}));

vi.mock('../repositories/user.repository.js', () => ({
  userRepository: {
    findById: async (uid: string) => {
      const data = store.get(`users/${uid}`);

      return data ? { ...data, uid } : null;
    },
  },
  UserRepository: class {},
}));

// The award path can send an email; it is not what is being tested here.
vi.mock('./email.service.js', () => ({
  sendCreditsNotification: vi.fn().mockResolvedValue(true),
}));

const {
  applyCredits,
  awardFinderCredits,
  awardSignupBonus,
  creditKey,
  getUserCredits,
  penalizeFalseClaim,
} = await import('./credits.service.js');

const { CREDIT_VALUES } = await import('../types/index.js');

function seedUser(uid: string, data: Doc = {}) {
  store.set(`users/${uid}`, { email: `${uid}@example.com`, credits: 0, ...data });
}

function ledgerEntries(): Doc[] {
  return [...store.entries()]
    .filter(([path]) => path.startsWith('creditTransactions/'))
    .map(([, data]) => data);
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('applyCredits', () => {
  it('writes the balance and the ledger entry together', async () => {
    seedUser('user-1');

    const result = await applyCredits('user-1', 'SIGNUP_BONUS');

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(CREDIT_VALUES.SIGNUP_BONUS);
    expect(store.get('users/user-1')?.credits).toBe(CREDIT_VALUES.SIGNUP_BONUS);
    expect(ledgerEntries()).toHaveLength(1);
  });

  /**
   * LOG-01: credits read and write hit the same store.
   *
   * The balance used to live in a `credits/{uid}` collection that nothing read,
   * while the app showed `users/{uid}.credits`.
   */
  it('LOG-01 the balance it writes is the balance it reads back', async () => {
    seedUser('user-1');

    await applyCredits('user-1', 'SIGNUP_BONUS');

    expect(await getUserCredits('user-1')).toBe(CREDIT_VALUES.SIGNUP_BONUS);
  });

  it('records the balance after the movement on the ledger entry', async () => {
    seedUser('user-1', { credits: 5 });

    await applyCredits('user-1', 'SIGNUP_BONUS');

    expect(ledgerEntries()[0]).toMatchObject({
      userId: 'user-1',
      amount: CREDIT_VALUES.SIGNUP_BONUS,
      balanceAfter: 5 + CREDIT_VALUES.SIGNUP_BONUS,
      reason: 'signup_bonus',
    });
  });

  /**
   * LOG-18: an award against a deleted account must not resurrect it.
   *
   * A merge-set would create a `users/{uid}` holding nothing but a balance,
   * from a stale `claimedBy` on a deleted account, and `authMiddleware` would
   * then resolve a role from a document that was never a profile.
   */
  it('LOG-18 refuses to award credits to an account that does not exist', async () => {
    const result = await applyCredits('ghost', 'SIGNUP_BONUS');

    expect(result.success).toBe(false);
    expect(store.has('users/ghost')).toBe(false);
    expect(ledgerEntries()).toHaveLength(0);
  });

  it('applies a negative amount as a deduction', async () => {
    seedUser('user-1', { credits: 50 });

    const result = await penalizeFalseClaim('user-1', 'item-1');

    expect(result.newBalance).toBe(50 + CREDIT_VALUES.FALSE_CLAIM);
  });

  it('carries the related item onto the ledger entry', async () => {
    seedUser('user-1');

    await awardFinderCredits('user-1', 'item-9');

    expect(ledgerEntries()[0]).toMatchObject({ relatedItemId: 'item-9' });
  });
});

describe('exactly-once awards', () => {
  /**
   * LOG-01b: the signup bonus lands once.
   *
   * Sign-in fires the profile bootstrap from two places at once, so the award
   * has to be idempotent by construction rather than by a check-then-write.
   */
  it('LOG-01b awards the signup bonus once however many times it is called', async () => {
    seedUser('user-1');

    const first = await awardSignupBonus('user-1');
    const second = await awardSignupBonus('user-1');
    const third = await awardSignupBonus('user-1');

    expect(first.alreadyApplied).toBe(false);
    expect(second.alreadyApplied).toBe(true);
    expect(third.alreadyApplied).toBe(true);

    expect(store.get('users/user-1')?.credits).toBe(CREDIT_VALUES.SIGNUP_BONUS);
    expect(ledgerEntries()).toHaveLength(1);
  });

  it('reports the current balance on a replay, not zero', async () => {
    seedUser('user-1');

    await awardSignupBonus('user-1');
    const replay = await awardSignupBonus('user-1');

    expect(replay.success).toBe(true);
    expect(replay.newBalance).toBe(CREDIT_VALUES.SIGNUP_BONUS);
    expect(replay.amount).toBe(0);
  });

  /**
   * The flag is what lets sign-in skip the award entirely on a return visit.
   * Skipping the patch on a replay would leave it permanently absent once the
   * ledger entry existed, so every future sign-in would pay for a transaction
   * that could not do anything.
   */
  it('still writes the awarded flag when the entry already exists', async () => {
    seedUser('user-1');
    // Built with the same function the service uses: a hand-written id that
    // does not match is a test that silently takes the first-award path and
    // proves nothing.
    store.set(`creditTransactions/${creditKey('SIGNUP_BONUS', 'user-1')}`, { userId: 'user-1' });

    const result = await awardSignupBonus('user-1');

    expect(result.alreadyApplied).toBe(true);
    expect(store.get('users/user-1')?.signupBonusAwarded).toBe(true);
    // The flag was written by the replay path, not by an award: the balance
    // never moved.
    expect(store.get('users/user-1')?.credits).toBe(0);
  });

  it('awards the finder once per item, and again for a different item', async () => {
    seedUser('finder');

    await awardFinderCredits('finder', 'item-1');
    await awardFinderCredits('finder', 'item-1');
    await awardFinderCredits('finder', 'item-2');

    expect(store.get('users/finder')?.credits).toBe(CREDIT_VALUES.SUCCESSFUL_MATCH_FINDER * 2);
    expect(ledgerEntries()).toHaveLength(2);
  });

  /**
   * A penalty is deliberately not idempotent: an admin may reject the same
   * user on the same item twice, and each rejection is its own penalty.
   */
  it('charges a false claim every time it is rejected', async () => {
    seedUser('claimant', { credits: 100 });

    await penalizeFalseClaim('claimant', 'item-1');
    await penalizeFalseClaim('claimant', 'item-1');

    expect(store.get('users/claimant')?.credits).toBe(100 + CREDIT_VALUES.FALSE_CLAIM * 2);
    expect(ledgerEntries()).toHaveLength(2);
  });
});

describe('CREDIT_VALUES', () => {
  it('rewards the finder more than the owner, since finding is the harder part', () => {
    expect(CREDIT_VALUES.SUCCESSFUL_MATCH_FINDER).toBeGreaterThan(
      CREDIT_VALUES.SUCCESSFUL_MATCH_OWNER,
    );
  });

  it('makes a false claim cost more than a successful return earns', () => {
    expect(Math.abs(CREDIT_VALUES.FALSE_CLAIM)).toBeGreaterThan(
      CREDIT_VALUES.SUCCESSFUL_MATCH_OWNER,
    );
  });
});
