/**
 * The saga: what it dispatches, what it declares, and what it does with a
 * step that has already run.
 *
 * The property worth the most here is idempotency. Every one of these five
 * jobs can be delivered twice — a worker that dies after doing the work and
 * before acknowledging it is the normal case, not the exotic one — and two of
 * them move money and mark physical property as handed over.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({ doc: () => ({}) }) }),
  default: {},
}));

const { routeEvent } = await import('../../platform/outbox/event.catalog.js');
const { BLOCKING_STEPS, SAGA_STEPS, STEP_DEFINITIONS, isSagaStep } = await import(
  './handover.saga.js'
);
const { HandoverSteps } = await import('./handover.steps.js');
const { RETRY_POLICIES } = await import('../../platform/jobs/job.types.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('routing a verified handover', () => {
  const payload = { handoverId: 'match-1', lostItemId: 'lost-1', foundItemId: 'found-1' };

  it('dispatches one job per side effect', () => {
    const dispatched = routeEvent('event-1', 'handover.verified', payload);

    expect(dispatched.map((job) => job.name).sort()).toEqual([...SAGA_STEPS].sort());
  });

  it('gives each step its own idempotency key', () => {
    const keys = routeEvent('event-1', 'handover.verified', payload).map((job) => job.idempotencyKey);

    expect(new Set(keys).size).toBe(keys.length);
    keys.forEach((key) => expect(key).toContain('match-1'));
  });

  it('keys on the event, so a redelivery is one run and a re-verification is another', () => {
    const first = routeEvent('event-1', 'handover.verified', payload);
    const again = routeEvent('event-1', 'handover.verified', payload);
    const second = routeEvent('event-2', 'handover.verified', payload);

    expect(again.map((job) => job.idempotencyKey)).toEqual(first.map((job) => job.idempotencyKey));
    expect(second.map((job) => job.idempotencyKey)).not.toEqual(
      first.map((job) => job.idempotencyKey),
    );
  });

  it('dispatches nothing for an event with no handover on it', () => {
    expect(routeEvent('event-1', 'handover.verified', {})).toEqual([]);
  });

  it('carries both item ids to every step', () => {
    routeEvent('event-1', 'handover.verified', payload).forEach((job) => {
      expect(job.payload).toMatchObject({ lostItemId: 'lost-1', foundItemId: 'found-1' });
    });
  });
});

describe('the step declarations', () => {
  it('declares a compensation for every step', () => {
    SAGA_STEPS.forEach((step) => {
      expect(STEP_DEFINITIONS[step].compensation.length).toBeGreaterThan(0);
      expect(STEP_DEFINITIONS[step].forward.length).toBeGreaterThan(0);
    });
  });

  it('never compensates the ledger or the chain by deleting anything', () => {
    // Both are append-only. A revert that edits them is a revert that destroys
    // the evidence it exists to preserve.
    expect(STEP_DEFINITIONS['handover.credits'].compensation).toContain('reversing');
    expect(STEP_DEFINITIONS['handover.chain'].compensation).toContain('revocation');
  });

  it('holds completion only for the two steps that decide what the system believes', () => {
    expect(BLOCKING_STEPS.sort()).toEqual(['handover.archive', 'handover.items']);
  });

  it('gives every step a retry policy', () => {
    SAGA_STEPS.forEach((step) => {
      expect(RETRY_POLICIES[step].attempts).toBeGreaterThan(0);
      expect(RETRY_POLICIES[step].timeoutMs).toBeGreaterThan(0);
    });
  });

  it('recognises its own steps and nothing else', () => {
    expect(isSagaStep('handover.items')).toBe(true);
    expect(isSagaStep('match.item')).toBe(false);
  });
});

describe('running a step', () => {
  function build(alreadyDone: boolean) {
    const markDone = vi.fn(async () => undefined);
    const apply = vi.fn(async () => ({ ok: true }));

    const steps = new HandoverSteps(
      {
        isDone: async () => alreadyDone,
        markDone,
        completed: async () => new Set(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { apply } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        resolveCodeRefById: async () => ({
          id: 'code-ref',
          // A settled handover. `runStep` reads the state before it does
          // anything, because a reverted or disputed handover must not have
          // its forward steps re-run whatever the step rows say.
          get: async () => ({ exists: true, data: () => ({ state: 'verified' }) }),
        }),
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );

    return { steps, markDone, apply };
  }

  const payload = { handoverId: 'match-1', lostItemId: 'lost-1', foundItemId: 'found-1' };

  it('does the work once and records it', async () => {
    const { steps, markDone } = build(false);
    const action = vi.fn(async () => ({ status: 'done' as const, undo: { priorStatus: 'Matched' } }));

    await steps.runStep('handover.items', payload, action);

    expect(action).toHaveBeenCalledTimes(1);
    expect(markDone).toHaveBeenCalledWith(
      expect.objectContaining({
        handoverId: 'match-1',
        step: 'handover.items',
        status: 'done',
        undo: { priorStatus: 'Matched' },
      }),
    );
  });

  it('does nothing at all when the step has already run', async () => {
    // The whole point. A redelivered credits job must not pay twice.
    const { steps, markDone } = build(true);
    const action = vi.fn(async () => ({ status: 'done' as const }));

    await steps.runStep('handover.credits', payload, action);

    expect(action).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  it('lets a failure propagate, so the runner can retry it', async () => {
    const { steps, markDone } = build(false);
    const action = vi.fn(async () => {
      throw new Error('firestore is down');
    });

    await expect(steps.runStep('handover.items', payload, action)).rejects.toThrow(
      'firestore is down',
    );

    // Not recorded as done, so the retry does the work rather than skipping it.
    expect(markDone).not.toHaveBeenCalled();
  });

  it('does not run a forward step against a handover that has been reverted', async () => {
    // Three of the five do not block completion, so a handover can reach
    // `completed` — and then be reverted — while one of them is still
    // retrying. Re-running it afterwards awards credits on a reverted
    // handover, or attests one that has just been revoked.
    const markDone = vi.fn(async () => undefined);

    const steps = new HandoverSteps(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { isDone: async () => false, markDone, completed: async () => new Set() } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { apply: vi.fn() } as any,
      {
        resolveCodeRefById: async () => ({
          id: 'code-ref',
          get: async () => ({ exists: true, data: () => ({ state: 'reverted' }) }),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );

    const action = vi.fn(async () => ({ status: 'done' as const }));

    await steps.runStep('handover.credits', payload, action);

    expect(action).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  it('records a skip, so a step that had nothing to do is not retried forever', async () => {
    const { steps, markDone } = build(false);
    const action = vi.fn(async () => ({ status: 'skipped' as const, detail: 'blockchain disabled' }));

    await steps.runStep('handover.chain', payload, action);

    expect(markDone).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped', detail: 'blockchain disabled' }),
    );
  });
});

describe('completing the handover', () => {
  function build(done: string[]) {
    const apply = vi.fn(async () => ({ ok: true, from: 'verified', to: 'completed', sequence: 2 }));

    const steps = new HandoverSteps(
      {
        isDone: async () => false,
        markDone: async () => undefined,
        completed: async () => new Set(done),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { apply } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        resolveCodeRefById: async () => ({
          id: 'code-ref',
          // A settled handover. `runStep` reads the state before it does
          // anything, because a reverted or disputed handover must not have
          // its forward steps re-run whatever the step rows say.
          get: async () => ({ exists: true, data: () => ({ state: 'verified' }) }),
        }),
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    );

    return { steps, apply };
  }

  const payload = { handoverId: 'match-1', lostItemId: 'lost-1', foundItemId: 'found-1' };

  it('waits for both blocking steps before it moves the handover', async () => {
    const { steps, apply } = build(['handover.items']);

    await steps.runStep('handover.items', payload, async () => ({ status: 'done' }));

    expect(apply).not.toHaveBeenCalled();
  });

  it('moves it once both have finished, whichever finished last', async () => {
    const { steps, apply } = build(['handover.items', 'handover.archive']);

    await steps.runStep('handover.archive', payload, async () => ({ status: 'done' }));

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1]).toMatchObject({
      matchId: 'match-1',
      transition: 'complete',
      actorRole: 'system',
    });
  });

  it('does not wait for the email or the chain', async () => {
    // A handover is not less true because a third party is down, and refusing
    // to record it would be the system lying about the world to protect its
    // own bookkeeping.
    const { steps, apply } = build(['handover.items', 'handover.archive']);

    await steps.runStep('handover.notify', payload, async () => ({ status: 'done' }));

    expect(apply).toHaveBeenCalledTimes(1);
  });
});
