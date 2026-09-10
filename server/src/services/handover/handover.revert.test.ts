/**
 * Revert and dispute.
 *
 * This is the file where a mistake takes credits off somebody who earned them,
 * puts a claimed item back on the board, or closes a complaint nobody read. So
 * what is pinned is mostly refusal: which states can be reverted, who may
 * dispute, what happens when a compensation fails partway, and that running
 * the same revert twice does the work once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({ doc: () => ({}) }) }),
  default: {},
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'server-timestamp',
    delete: () => 'delete',
    arrayUnion: (...values: unknown[]) => ({ arrayUnion: values }),
  },
}));

vi.mock('../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env.js')>();

  return {
    env: {
      ...actual.env,
      handover: { ...actual.env.handover, disputeWindowDays: 30 },
      blockchain: { ...actual.env.blockchain, enabled: false },
    },
  };
});

const { HandoverRevertService } = await import('./handover.revert.js');

const DAY = 24 * 60 * 60 * 1000;

/** A stored session document, as the service reads it. */
function stored(state: string) {
  return { state, lostItemId: 'lost-1', foundItemId: 'found-1' };
}

function build(options: {
  state: string;
  handoverTime?: Date | null;
  compensations?: Partial<Record<string, () => Promise<unknown>>>;
  applyOk?: boolean;
  /** False means the dispute row has already been resolved. */
  openDispute?: boolean;
}) {
  const applied: unknown[] = [];
  const disputeWrites: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const frozen: string[] = [];
  const unfrozen: string[] = [];

  const ran: string[] = [];

  const compensations = {
    run: vi.fn(async (step: string, context: unknown, action: () => Promise<unknown>) => {
      ran.push(step);

      const override = options.compensations?.[step];

      if (override) return override();

      return action();
    }),
    sendCorrections: async () => ({ step: 'handover.notify', status: 'compensated', detail: '' }),
    revokeAttestation: async () => ({ step: 'handover.chain', status: 'nothing_to_undo', detail: '' }),
    reverseCredits: async () => ({ step: 'handover.credits', status: 'compensated', detail: '' }),
    restoreMatch: async () => ({ step: 'handover.archive', status: 'compensated', detail: '' }),
    restoreItems: async () => ({ step: 'handover.items', status: 'compensated', detail: '' }),
  };

  const machine = {
    apply: vi.fn(async (_ref: unknown, request: Record<string, unknown>) => {
      applied.push(request);

      return options.applyOk === false
        ? { ok: false, reason: 'refused', from: options.state }
        : { ok: true, from: options.state, to: 'reverted', sequence: 2 };
    }),
  };

  const handovers = {
    resolveCodeRefById: async () => ({ id: 'code-ref' }),
    findCompletedById: async () => ({
      lostPersonId: 'owner-1',
      foundPersonId: 'finder-1',
      handoverTime:
        options.handoverTime === null
          ? undefined
          : { toDate: () => options.handoverTime ?? new Date() },
    }),
    writeAudit: async (entry: Record<string, unknown>) => {
      audits.push(entry);
    },
    freezeHandoverCredits: async (id: string) => {
      frozen.push(id);
    },
    unfreezeHandoverCredits: async (id: string) => {
      unfrozen.push(id);
    },
  };

  // The session document the service reads before it does anything.
  const snapshot = { exists: true, data: () => stored(options.state) };

  handovers.resolveCodeRefById = async () => ({ id: 'code-ref', get: async () => snapshot }) as never;

  const disputes = {
    doc: () => ({
      get: async () => ({
        exists: options.openDispute !== false,
        data: () => ({ status: options.openDispute === false ? 'resolved' : 'open' }),
      }),
      set: async (data: Record<string, unknown>) => {
        disputeWrites.push(data);
      },
    }),
    where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
  };

  const reset: string[] = [];

  const escalated: Array<{ step: string; message: string }> = [];

  const saga = {
    resetForRevert: async (id: string) => {
      reset.push(id);
    },
    escalate: async (_id: string, step: string, error: unknown) => {
      escalated.push({ step, message: error instanceof Error ? error.message : String(error) });
    },
  };

  const service = new HandoverRevertService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compensations as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    machine as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handovers as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    disputes as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saga as any,
  );

  return {
    service,
    machine,
    ran,
    applied,
    disputeWrites,
    audits,
    frozen,
    unfrozen,
    reset,
    escalated,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('what may be reverted', () => {
  it('reverts a completed handover', async () => {
    const { service, applied } = build({ state: 'completed' });

    const result = await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(result.success).toBe(true);
    expect((applied[0] as { transition: string }).transition).toBe('revert');
  });

  it('reverts a disputed one, which is how an upheld dispute is settled', async () => {
    const { service } = build({ state: 'disputed' });

    expect((await service.revert('match-1', 'upheld after review', 'admin-1')).success).toBe(true);
  });

  it('refuses a handover that has not completed', async () => {
    const { service, ran } = build({ state: 'code_issued' });

    const result = await service.revert('match-1', 'a good reason here', 'admin-1');

    expect(result.success).toBe(false);
    // Nothing was undone, because nothing had been done.
    expect(ran).toHaveLength(0);
  });

  it('answers a handover that is already reverted without doing anything again', async () => {
    const { service, ran } = build({ state: 'reverted' });

    const result = await service.revert('match-1', 'a good reason here', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.message).toContain('already been reverted');
    expect(ran).toHaveLength(0);
  });
});

describe('the order the compensations run in', () => {
  it('undoes the recoverable steps first and tells the parties last', async () => {
    // The notice is the only step that cannot be taken back, so it waits until
    // the revert is real. Sending it first meant a revert that then failed had
    // already told two people their credits were reversed and their reports
    // restored, while both were still exactly as they had been.
    const { service, ran } = build({ state: 'completed' });

    await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(ran).toEqual([
      'handover.chain',
      'handover.credits',
      'handover.archive',
      'handover.items',
      'handover.notify',
    ]);
  });

  it('does not tell either party when the revert stopped partway', async () => {
    const { service, ran } = build({
      state: 'completed',
      compensations: {
        'handover.credits': async () => {
          throw new Error('the ledger is down');
        },
      },
    });

    await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(ran).not.toContain('handover.notify');
  });

  it('escalates a revert that found nothing to undo, instead of reporting plain success', async () => {
    // A handover completed before the step log existed has nothing captured,
    // so all four recoverable compensations no-op. Left alone it is marked
    // reverted while the items are still claimed and the credits still
    // awarded, and the admin is told it worked.
    const nothing = (step: string) => async () => ({ step, status: 'nothing_to_undo', detail: '' });
    const { service, escalated } = build({
      state: 'completed',
      compensations: {
        'handover.chain': nothing('handover.chain'),
        'handover.credits': nothing('handover.credits'),
        'handover.archive': nothing('handover.archive'),
        'handover.items': nothing('handover.items'),
        'handover.notify': nothing('handover.notify'),
      },
    });

    const result = await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.message).toContain('nothing was undone');
    expect(escalated).toHaveLength(1);
    expect(escalated[0].message).toContain('by hand');
  });

  it('does not escalate when at least one compensation did real work', async () => {
    const { service, escalated } = build({ state: 'completed' });

    await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(escalated).toHaveLength(0);
  });

  it('clears the forward step records, so a re-verified handover runs its saga again', async () => {
    const { service, reset } = build({ state: 'completed' });

    await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(reset).toEqual(['match-1']);
  });

  it('releases the credit hold, because the credits have been reversed', async () => {
    const { service, unfrozen } = build({ state: 'completed' });

    await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(unfrozen).toEqual(['match-1']);
  });

  it('stops where a compensation failed, rather than carrying on', async () => {
    const { service, ran, applied } = build({
      state: 'completed',
      compensations: {
        'handover.credits': async () => {
          throw new Error('the ledger is down');
        },
      },
    });

    const result = await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(result.success).toBe(false);
    expect(result.message).toContain('handover.credits');
    // The two after it, which are closer to the physical world, did not run.
    expect(ran).toEqual(['handover.chain', 'handover.credits']);
    // And the handover was not moved: it is not reverted, it is half undone.
    expect(applied).toHaveLength(0);
  });

  it('reports what did run, so the next attempt knows where it got to', async () => {
    const { service } = build({
      state: 'completed',
      compensations: {
        'handover.archive': async () => {
          throw new Error('firestore is down');
        },
      },
    });

    const result = await service.revert('match-1', 'the owner never received it', 'admin-1');

    expect(result.compensations?.map((entry) => entry.step)).toEqual([
      'handover.chain',
      'handover.credits',
    ]);
  });
});

describe('raising a dispute', () => {
  it('moves a completed handover to disputed and freezes the credits', async () => {
    // Frozen, not reversed. Reversing would decide the dispute in advance, and
    // the whole point of `disputed` is that nobody has decided yet.
    const { service, applied, frozen } = build({ state: 'completed' });

    const result = await service.raiseDispute('match-1', 'owner-1', 'owner', 'never_received', null);

    expect(result.success).toBe(true);
    expect((applied[0] as { transition: string }).transition).toBe('dispute');
    expect(frozen).toEqual(['match-1']);
  });

  it('refuses a handover that has not completed', async () => {
    const { service, applied } = build({ state: 'code_issued' });

    const result = await service.raiseDispute('match-1', 'owner-1', 'owner', 'wrong_item', null);

    expect(result.success).toBe(false);
    expect(applied).toHaveLength(0);
  });

  it('joins an open dispute rather than opening a second one', async () => {
    const { service, applied, disputeWrites } = build({ state: 'disputed' });

    const result = await service.raiseDispute('match-1', 'finder-1', 'finder', 'not_my_item', null);

    expect(result.success).toBe(true);
    // No second transition: the handover is already disputed.
    expect(applied).toHaveLength(0);
    expect(disputeWrites).toHaveLength(1);
  });

  it('refuses a party once the window has closed', async () => {
    const { service, applied } = build({
      state: 'completed',
      handoverTime: new Date(Date.now() - 60 * DAY),
    });

    const result = await service.raiseDispute('match-1', 'owner-1', 'owner', 'never_received', null);

    expect(result.success).toBe(false);
    expect(result.message).toContain('30 days');
    expect(applied).toHaveLength(0);
  });

  it('lets an admin raise one outside the window', async () => {
    const { service, applied } = build({
      state: 'completed',
      handoverTime: new Date(Date.now() - 60 * DAY),
    });

    const result = await service.raiseDispute('match-1', 'admin-1', 'admin', 'other', 'escalated');

    expect(result.success).toBe(true);
    expect(applied).toHaveLength(1);
  });

  it('allows a dispute on a handover with no recorded time', async () => {
    // The case a pre-phase-26 session lands in. The cost of allowing a late
    // dispute is an admin reading it; the cost of refusing a valid one is
    // somebody with a real complaint being told no.
    const { service } = build({ state: 'completed', handoverTime: null });

    const result = await service.raiseDispute('match-1', 'owner-1', 'owner', 'never_received', null);

    expect(result.success).toBe(true);
  });
});

describe('resolving a dispute', () => {
  it('upholding it runs the revert', async () => {
    const { service, ran } = build({ state: 'disputed' });

    const result = await service.resolveDispute('match-1', 'admin-1', 'upheld', 'the item is gone');

    expect(result.success).toBe(true);
    expect(ran).toHaveLength(5);
  });

  it('rejecting it returns the handover to completed and releases the hold', async () => {
    const { service, applied, unfrozen } = build({ state: 'disputed' });

    const result = await service.resolveDispute('match-1', 'admin-1', 'rejected', 'no evidence');

    expect(result.success).toBe(true);
    expect((applied[0] as { transition: string }).transition).toBe('complete');
    expect((applied[0] as { expect: string[] }).expect).toEqual(['disputed']);
    expect(unfrozen).toEqual(['match-1']);
  });

  it('refuses either decision once the dispute row is closed', async () => {
    // Two admins on a stale queue. Without this the second could uphold a
    // dispute the first had already rejected: `revert` accepts a completed
    // handover, so it would reverse credits and email both parties about a
    // decision that had been made the other way.
    const { service, applied, ran } = build({ state: 'completed', openDispute: false });

    const rejected = await service.resolveDispute('match-1', 'admin-1', 'rejected', 'no evidence');
    const upheld = await service.resolveDispute('match-1', 'admin-2', 'upheld', 'the item is gone');

    expect(rejected.success).toBe(false);
    expect(upheld.success).toBe(false);
    expect(applied).toHaveLength(0);
    expect(ran).toHaveLength(0);
  });

  it('finishes a rejection whose transition committed before it died', async () => {
    // `completed` with the row still open is a half-finished rejection. The
    // recovery is to finish it; refusing would leave the row in the queue with
    // the credits held, and the only escape would be to uphold a dispute the
    // admin had decided against.
    const { service, unfrozen } = build({ state: 'completed' });

    const result = await service.resolveDispute('match-1', 'admin-1', 'rejected', 'no evidence');

    expect(result.success).toBe(true);
    expect(unfrozen).toEqual(['match-1']);
  });
});
