/**
 * The compensations themselves.
 *
 * Each one is the answer to "what does undoing this actually mean", and three
 * of the five cannot be a delete even in principle. So what is pinned here is
 * mostly that they refuse to guess: an item whose prior status nobody recorded
 * is left alone, an award that was never made is not reversed, and an
 * attestation that was never written is not revoked.
 *
 * Guessing is the failure mode that matters. A compensation that invents a
 * plausible prior status puts a claimed item back on the board; one that posts
 * a reversal for an award that never happened takes credits off somebody who
 * never received them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({ doc: () => ({}) }) }),
  default: {},
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'server-timestamp', delete: () => 'delete' },
}));

const blockchainEnabled = { value: false };

vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>();

  return {
    env: {
      ...actual.env,
      get blockchain() {
        return { ...actual.env.blockchain, enabled: blockchainEnabled.value };
      },
    },
  };
});

const reverseHandoverCredits = vi.fn();

vi.mock('../credits.service.js', () => ({
  reverseHandoverCredits: (...args: unknown[]) => reverseHandoverCredits(...(args as [])),
}));

const sendHandoverCorrectionNotice = vi.fn();

vi.mock('../email.service.js', () => ({
  sendHandoverCorrectionNotice: (...args: unknown[]) =>
    sendHandoverCorrectionNotice(...(args as [])),
}));

const { HandoverCompensations } = await import('./handover.compensations.js');

const CONTEXT = {
  handoverId: 'match-1',
  lostItemId: 'lost-1',
  foundItemId: 'found-1',
  reason: 'the owner never received it',
  actorId: 'admin-1',
};

function build(options: {
  undo?: Record<string, unknown> | null;
  items?: Record<string, { status: string } | null>;
  archived?: Record<string, unknown> | null;
  completed?: Record<string, unknown> | null;
}) {
  const itemWrites: Array<{ id: string; data: Record<string, unknown>; options?: unknown }> = [];
  const matchWrites: Array<{ data: Record<string, unknown>; options?: unknown }> = [];
  const revocations: Array<Record<string, unknown>> = [];

  const marked: string[] = [];
  const released: string[] = [];
  const claimable = { value: true };

  const saga = {
    capturedUndo: async () => options.undo ?? null,
    isCompensated: async () => false,
    claimCompensation: async () => claimable.value,
    markCompensated: async (_id: string, step: string) => {
      marked.push(step);
    },
    releaseCompensationClaim: async (_id: string, step: string) => {
      released.push(step);
    },
  };

  const handovers = {
    findCompletedById: async () => options.completed ?? null,
    recordChainRevocation: async (_id: string, revocation: Record<string, unknown>) => {
      revocations.push(revocation);
    },
    loadCompletionContext: async () => ({
      lostItem: { name: 'Black wallet', reportedByEmail: 'owner@example.com' },
      foundItem: { name: 'Wallet', reportedByEmail: 'finder@example.com' },
      matchData: null,
      lostItemExists: true,
      foundItemExists: true,
    }),
  };

  const items = {
    doc: (id: string) => ({
      get: async () => ({
        exists: options.items?.[id] !== null && options.items?.[id] !== undefined,
        data: () => options.items?.[id],
      }),
      // The options are captured, not dropped: without them, deleting
      // `{ merge: true }` from the item write leaves the suite green while
      // production overwrites each item document with two fields, losing the
      // name, the images and the reporter.
      set: async (data: Record<string, unknown>, options?: unknown) => {
        itemWrites.push({ id, data, options });
      },
    }),
  };

  const matches = {
    doc: () => ({
      set: async (data: Record<string, unknown>, options?: unknown) => {
        matchWrites.push({ data, options });
      },
    }),
  };

  const matchHistory = {
    doc: () => ({
      get: async () => ({
        exists: Boolean(options.archived),
        data: () => options.archived,
      }),
    }),
  };

  const compensations = new HandoverCompensations(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saga as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handovers as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    matches as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    matchHistory as any,
  );

  return { compensations, itemWrites, matchWrites, revocations, marked, released, claimable };
}

beforeEach(() => {
  // Not `clearAllMocks`. That resets the call lists and leaves the
  // implementations, so a test that made a reversal fail left every test
  // declared after it failing too, and the suite passed or not depending on
  // the order it happened to run in.
  vi.resetAllMocks();
  reverseHandoverCredits.mockResolvedValue({
    success: true,
    newBalance: 0,
    amount: -10,
    alreadyApplied: false,
  });
  sendHandoverCorrectionNotice.mockResolvedValue(true);
  blockchainEnabled.value = false;
});

describe('restoring the items', () => {
  it('puts each item back to the status the forward step captured', async () => {
    const { compensations, itemWrites } = build({
      undo: { priorStatus: { 'lost-1': 'Matched', 'found-1': 'Pending' } },
      items: { 'lost-1': { status: 'Claimed' }, 'found-1': { status: 'Claimed' } },
    });

    const result = await compensations.restoreItems(CONTEXT);

    expect(result.status).toBe('compensated');
    expect(itemWrites).toEqual([
      {
        id: 'lost-1',
        data: expect.objectContaining({ status: 'Matched' }),
        options: { merge: true },
      },
      {
        id: 'found-1',
        data: expect.objectContaining({ status: 'Pending' }),
        options: { merge: true },
      },
    ]);
  });

  it('leaves both alone when nothing was captured', async () => {
    // Putting a claimed item back on the board because nobody recorded where
    // it came from is worse than telling an admin it needs a decision.
    const { compensations, itemWrites } = build({
      undo: null,
      items: { 'lost-1': { status: 'Claimed' } },
    });

    const result = await compensations.restoreItems(CONTEXT);

    expect(result.status).toBe('nothing_to_undo');
    expect(itemWrites).toHaveLength(0);
  });

  it('skips an item that no longer exists rather than recreating it', async () => {
    const { compensations, itemWrites } = build({
      undo: { priorStatus: { 'lost-1': 'Matched', 'found-1': 'Pending' } },
      items: { 'lost-1': { status: 'Claimed' }, 'found-1': null },
    });

    const result = await compensations.restoreItems(CONTEXT);

    expect(result.status).toBe('compensated');
    expect(itemWrites).toHaveLength(1);
    expect(result.detail).toContain('no longer exist');
  });
});

describe('restoring the match', () => {
  it('puts the archived copy back in the active collection', async () => {
    const { compensations, matchWrites } = build({
      archived: { lostItemId: 'lost-1', foundItemId: 'found-1', matchScore: 82 },
    });

    const result = await compensations.restoreMatch(CONTEXT);

    expect(result.status).toBe('compensated');
    expect(matchWrites[0].data).toMatchObject({ matchScore: 82, status: 'matched' });
    expect(matchWrites[0].options).toEqual({ merge: true });
  });

  it('clears the fields that describe a completion which has been undone', async () => {
    const { compensations, matchWrites } = build({ archived: { matchScore: 82 } });

    await compensations.restoreMatch(CONTEXT);

    expect(matchWrites[0].data.claimedAt).toBe('delete');
    expect(matchWrites[0].data.handoverId).toBe('delete');
  });

  it('does nothing when the match was synthesised and never persisted', async () => {
    const { compensations, matchWrites } = build({
      undo: { hadActiveMatch: false },
      archived: { matchScore: 82 },
    });

    const result = await compensations.restoreMatch(CONTEXT);

    expect(result.status).toBe('nothing_to_undo');
    expect(matchWrites).toHaveLength(0);
  });
});

describe('reversing the credits', () => {
  it('posts a reversing entry for each party', async () => {
    const { compensations } = build({
      completed: { lostPersonId: 'owner-1', foundPersonId: 'finder-1' },
    });

    const result = await compensations.reverseCredits(CONTEXT);

    expect(result.status).toBe('compensated');
    expect(reverseHandoverCredits).toHaveBeenCalledTimes(2);
    expect(reverseHandoverCredits).toHaveBeenCalledWith(
      'owner-1',
      'SUCCESSFUL_MATCH_OWNER',
      'lost-1',
      expect.stringContaining('reverted'),
    );
  });

  it('reverses nothing when neither party is on the record', async () => {
    const { compensations } = build({ completed: {} });

    const result = await compensations.reverseCredits(CONTEXT);

    expect(result.status).toBe('nothing_to_undo');
    expect(reverseHandoverCredits).not.toHaveBeenCalled();
  });

  it('reports nothing undone when there was no award to reverse', async () => {
    // `reverseHandoverCredits` answers `amount: 0` when the original entry
    // does not exist, which is how a skipped or escalated credits step avoids
    // taking credits nobody received.
    reverseHandoverCredits.mockResolvedValue({
      success: true,
      newBalance: 0,
      amount: 0,
      alreadyApplied: true,
    });

    const { compensations } = build({
      completed: { lostPersonId: 'owner-1', foundPersonId: 'finder-1' },
    });

    expect((await compensations.reverseCredits(CONTEXT)).status).toBe('nothing_to_undo');
  });

  it('fails the revert rather than continuing when a reversal cannot be posted', async () => {
    reverseHandoverCredits.mockResolvedValue({
      success: false,
      newBalance: 0,
      amount: -10,
      alreadyApplied: false,
    });

    const { compensations } = build({ completed: { lostPersonId: 'owner-1' } });

    await expect(compensations.reverseCredits(CONTEXT)).rejects.toThrow('owner-1');
  });
});

describe('revoking the attestation', () => {
  it('writes a revocation referencing the original transaction', async () => {
    blockchainEnabled.value = true;

    const { compensations, revocations } = build({ completed: { blockchainTxHash: '0xabc' } });

    const result = await compensations.revokeAttestation(CONTEXT);

    expect(result.status).toBe('compensated');
    expect(revocations[0]).toMatchObject({ revokesTxHash: '0xabc', onChain: false });
  });

  it('revokes an attestation even after the chain was switched off', async () => {
    // A deployment that attested a handover and later disabled the chain still
    // has an attestation on a public ledger. Checking the flag first meant the
    // revocation was skipped, recorded as compensated, and never written.
    const { compensations, revocations } = build({ completed: { blockchainTxHash: '0xabc' } });

    expect((await compensations.revokeAttestation(CONTEXT)).status).toBe('compensated');
    expect(revocations[0]).toMatchObject({ revokesTxHash: '0xabc' });
  });

  it('does nothing when no attestation was ever written', async () => {
    blockchainEnabled.value = true;

    const { compensations, revocations } = build({ completed: {} });

    expect((await compensations.revokeAttestation(CONTEXT)).status).toBe('nothing_to_undo');
    expect(revocations).toHaveLength(0);
  });
});

describe('the correction notice', () => {
  it('writes to both parties, carrying the reason', async () => {
    const { compensations } = build({ completed: {} });

    const result = await compensations.sendCorrections(CONTEXT);

    expect(result.status).toBe('compensated');
    expect(sendHandoverCorrectionNotice).toHaveBeenCalledTimes(2);
    expect(sendHandoverCorrectionNotice).toHaveBeenCalledWith(
      'owner@example.com',
      'Black wallet',
      CONTEXT.reason,
    );
  });

  it('fails the revert when a notice could not be sent', async () => {
    // The parties were told the handover completed. A revert they are not told
    // about leaves them believing something untrue.
    sendHandoverCorrectionNotice.mockResolvedValue(false);

    const { compensations } = build({ completed: {} });

    await expect(compensations.sendCorrections(CONTEXT)).rejects.toThrow('match-1');
  });
});

describe('running a compensation twice', () => {
  it('does the work once', async () => {
    const { compensations } = build({ completed: {} });
    const action = vi.fn(async () => ({
      step: 'handover.notify' as const,
      status: 'compensated' as const,
      detail: '',
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (compensations as any).saga.isCompensated = async () => true;

    const result = await compensations.run('handover.notify', CONTEXT, action);

    expect(action).not.toHaveBeenCalled();
    expect(result.status).toBe('nothing_to_undo');
  });

  it('records that it ran, so the next attempt can see it', async () => {
    // Without this, deleting the `markCompensated` call leaves the suite green
    // and the run-once test above passes on a fake that says "already done"
    // rather than on anything the code wrote. In production the second revert
    // would then reverse the credits again.
    const { compensations, marked } = build({ completed: {} });

    await compensations.run('handover.notify', CONTEXT, async () => ({
      step: 'handover.notify' as const,
      status: 'compensated' as const,
      detail: '',
    }));

    expect(marked).toEqual(['handover.notify']);
  });

  it('does not record a step that had nothing to undo', async () => {
    // A step that no-ops now may have real work to undo once the thing it
    // compensates has actually happened, so marking it would wedge it shut.
    const { compensations, marked } = build({ completed: {} });

    await compensations.run('handover.notify', CONTEXT, async () => ({
      step: 'handover.notify' as const,
      status: 'nothing_to_undo' as const,
      detail: '',
    }));

    expect(marked).toEqual([]);
  });

  it('releases its claim when the compensation throws, so a retry can run it', async () => {
    const { compensations, released } = build({ completed: {} });

    await expect(
      compensations.run('handover.notify', CONTEXT, async () => {
        throw new Error('the mail server is down');
      }),
    ).rejects.toThrow('the mail server is down');

    expect(released).toEqual(['handover.notify']);
  });

  it('stands aside when another revert already holds the claim', async () => {
    const { compensations, claimable } = build({ completed: {} });
    claimable.value = false;
    const action = vi.fn();

    const result = await compensations.run('handover.notify', CONTEXT, action);

    expect(action).not.toHaveBeenCalled();
    expect(result.status).toBe('nothing_to_undo');
  });
});

describe('refusing to guess', () => {
  it('does nothing when the handover names no items', async () => {
    // `restoreItems` is driven by the ids on the context. An empty pair is a
    // malformed handover, not a licence to write to whatever the captured undo
    // happens to be keyed on.
    const { compensations, itemWrites } = build({
      undo: { priorStatus: { 'lost-1': 'Matched' } },
      items: { 'lost-1': { status: 'Claimed' } },
    });

    const result = await compensations.restoreItems({
      ...CONTEXT,
      lostItemId: '',
      foundItemId: '',
    });

    expect(result.status).toBe('nothing_to_undo');
    expect(itemWrites).toHaveLength(0);
  });
});
