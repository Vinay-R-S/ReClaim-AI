/**
 * Applying a transition.
 *
 * What is pinned here is the atomicity claim the rest of section 10 rests on:
 * the event, the projection and the domain event are one commit, and a refused
 * move writes none of the three. If a refusal could still append an event, the
 * log would record transitions that never happened and the projection would
 * disagree with it; if the outbox row could commit without the transition, the
 * saga would run for a handover that had not been verified.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({ doc: () => ({ id: 'stub' }) }) }),
  default: {},
}));

vi.mock('../../platform/tracing/context.js', () => ({
  currentTraceparent: () => 'test-traceparent',
}));

const { HandoverMachine, stateOf } = await import('./handover.machine.js');

/** A transaction that records what was written rather than writing it. */
function fakeFirestore(stored: Record<string, unknown> | undefined) {
  const sets: Array<{ ref: unknown; data: Record<string, unknown>; options?: unknown }> = [];

  const tx = {
    get: async () => ({
      exists: stored !== undefined,
      data: () => stored,
      ref: { id: 'code-ref' },
    }),
    // The options are captured, not dropped. Without them, deleting
    // `{ merge: true }` from the projection write left every machine test
    // green while turning each transition into a full overwrite that wipes
    // the code hash, the expiry, the attempt count and both item ids.
    set: (ref: unknown, data: Record<string, unknown>, options?: unknown) => {
      sets.push({ ref, data, options });
    },
  };

  return {
    sets,
    firestore: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runTransaction: async (fn: (t: any) => Promise<unknown>) => fn(tx),
    },
  };
}

function build(stored: Record<string, unknown> | undefined) {
  const { sets, firestore } = fakeFirestore(stored);
  const events: unknown[] = [];
  const published: unknown[] = [];

  const machine = new HandoverMachine(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { append: (_tx: unknown, event: unknown) => { events.push(event); return 'event-id'; } } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { appendInTransaction: (_tx: unknown, event: unknown) => { published.push(event); return 'outbox-id'; } } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    firestore as any,
  );

  return { machine, sets, events, published };
}

const REF = { id: 'code-ref' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stateOf', () => {
  it('prefers the stored state', () => {
    expect(stateOf({ state: 'awaiting_meet', status: 'pending' })).toBe('awaiting_meet');
  });

  it('falls back to the legacy status for a document written before the log', () => {
    expect(stateOf({ status: 'blocked' })).toBe('blocked');
  });

  it('treats a document that does not exist as a session not yet opened', () => {
    expect(stateOf(undefined)).toBe('initiated');
  });

  it('ignores a state that is not one of ours', () => {
    expect(stateOf({ state: 'nonsense', status: 'blocked' })).toBe('blocked');
  });
});

describe('apply', () => {
  it('writes the event and the projection together', async () => {
    const { machine, sets, events } = build(undefined);

    const outcome = await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'issue_code',
      actor: 'admin-1',
      actorRole: 'admin',
      patch: { codeHash: 'hash' },
    });

    expect(outcome).toMatchObject({ ok: true, from: 'initiated', to: 'code_issued', sequence: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      handoverId: 'match-1',
      from: null,
      to: 'code_issued',
      transition: 'issue_code',
      actor: 'admin-1',
      sequence: 1,
    });
    expect(sets[0].data).toMatchObject({ state: 'code_issued', codeHash: 'hash', sequence: 1 });
  });

  it('merges the projection rather than replacing it', async () => {
    // A full overwrite would wipe the code hash, the expiry, the attempt count
    // and both item ids on every transition, which is every field verification
    // reads.
    const { machine, sets } = build({ state: 'code_issued', sequence: 1 });

    await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'block',
      actor: null,
      actorRole: 'system',
    });

    expect(sets[0].options).toEqual({ merge: true });
  });

  it('stamps when the state last changed', async () => {
    const { machine, sets } = build({ state: 'code_issued', sequence: 1 });

    await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'expire',
      actor: null,
      actorRole: 'system',
    });

    expect(sets[0].data.stateChangedAt).toBeDefined();
  });

  it('keeps the legacy status in step, so a reader that predates the log still works', async () => {
    const { machine, sets } = build({ state: 'verified', sequence: 3 });

    await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'complete',
      actor: null,
      actorRole: 'system',
    });

    expect(sets[0].data).toMatchObject({ state: 'completed', status: 'verified' });
  });

  it('writes nothing at all when the table refuses the move', async () => {
    const { machine, sets, events, published } = build({ state: 'blocked', sequence: 2 });

    const outcome = await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'issue_code',
      actor: null,
      actorRole: 'system',
    });

    expect(outcome).toEqual({ ok: false, reason: 'refused', from: 'blocked' });
    expect(events).toHaveLength(0);
    expect(sets).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it('refuses a legal move from a state the caller did not expect', async () => {
    const { machine, events } = build({ state: 'expired', sequence: 4 });

    const outcome = await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'reissue_code',
      actor: null,
      actorRole: 'admin',
      expect: ['blocked'],
    });

    expect(outcome).toEqual({ ok: false, reason: 'refused', from: 'expired' });
    expect(events).toHaveLength(0);
  });

  it('advances the sequence, so two transitions cannot share an event id', async () => {
    const { machine, events } = build({ state: 'code_issued', sequence: 7 });

    await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'block',
      actor: null,
      actorRole: 'system',
    });

    expect(events[0]).toMatchObject({ sequence: 8 });
  });

  it('publishes the domain event in the same commit as the transition', async () => {
    const { machine, published, events } = build({ state: 'code_issued', sequence: 1 });

    await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'confirm_receipt',
      actor: null,
      actorRole: 'finder',
      publish: {
        name: 'handover.verified',
        payload: { handoverId: 'match-1', lostItemId: 'lost-1', foundItemId: 'found-1' },
      },
    });

    expect(events).toHaveLength(1);
    expect(published).toEqual([
      {
        name: 'handover.verified',
        payload: { handoverId: 'match-1', lostItemId: 'lost-1', foundItemId: 'found-1' },
      },
    ]);
  });

  it('does not publish when the move is refused', async () => {
    const { machine, published } = build({ state: 'completed', sequence: 5 });

    await machine.apply(REF, {
      matchId: 'match-1',
      transition: 'confirm_receipt',
      actor: null,
      actorRole: 'finder',
      publish: {
        name: 'handover.verified',
        payload: { handoverId: 'match-1', lostItemId: 'lost-1', foundItemId: 'found-1' },
      },
    });

    expect(published).toHaveLength(0);
  });
});

describe('decide', () => {
  it('carries the caller answer out of the transaction alongside the outcome', async () => {
    const { machine } = build({ state: 'code_issued', attempts: 1, sequence: 2 });

    const { result, outcome } = await machine.decide<string>(REF, 'match-1', (data, from) => {
      expect(from).toBe('code_issued');
      expect(data).toMatchObject({ attempts: 1 });

      return {
        kind: 'transition',
        plan: { transition: 'fail_attempt', actor: null, actorRole: 'system' },
        result: 'two left',
      };
    });

    expect(result).toBe('two left');
    expect(outcome).toMatchObject({ ok: true, to: 'code_issued' });
  });

  it('lets the caller refuse without the table being consulted', async () => {
    const { machine, events, sets } = build({ state: 'code_issued', sequence: 1 });

    const { result, outcome } = await machine.decide<string>(REF, 'match-1', () => ({
      kind: 'refuse',
      result: 'too soon',
    }));

    expect(result).toBe('too soon');
    expect(outcome).toEqual({ ok: false, reason: 'refused', from: 'code_issued' });
    expect(events).toHaveLength(0);
    expect(sets).toHaveLength(0);
  });
});
