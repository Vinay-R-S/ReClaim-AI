/**
 * The escalation, which is the only thing this layer adds.
 *
 * A saga step that fails with retries left should throw and be retried. A step
 * that fails on its last attempt has to escalate, because past the point where
 * the credential was accepted the physical handover has already happened and
 * no amount of further retrying changes that. Nothing else in the codebase
 * knows which attempt this is, so nothing else can make that distinction —
 * and it had no test at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({ doc: () => ({}) }) }),
  default: {},
}));

const runStep = vi.fn();
const escalate = vi.fn(async () => undefined);

vi.mock('../../../services/handover/handover.steps.js', () => ({
  handoverSteps: {
    runStep: (...args: unknown[]) => runStep(...args),
    moveItems: vi.fn(),
    archiveMatch: vi.fn(),
    awardCredits: vi.fn(),
    notify: vi.fn(),
    recordOnChain: vi.fn(),
  },
}));

vi.mock('../../../services/handover/handover.saga.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/handover/handover.saga.js')>();

  return {
    ...actual,
    handoverSagaRepository: { escalate: (...args: unknown[]) => escalate(...args) },
  };
});

const { handoverItemsHandler, handoverChainHandler } = await import('./handover-step.handler.js');

const PAYLOAD = { handoverId: 'match-1', lostItemId: 'lost-1', foundItemId: 'found-1' };

function context(attempt: number, maxAttempts = 5) {
  return {
    attempt,
    maxAttempts,
    idempotencyKey: 'handover.items:match-1:event-1',
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a step that succeeds', () => {
  it('escalates nothing', async () => {
    runStep.mockResolvedValue(undefined);

    await handoverItemsHandler(PAYLOAD, context(1));

    expect(escalate).not.toHaveBeenCalled();
  });

  it('runs the step it is bound to', async () => {
    runStep.mockResolvedValue(undefined);

    await handoverChainHandler(PAYLOAD, context(1));

    expect(runStep).toHaveBeenCalledWith('handover.chain', PAYLOAD, expect.any(Function));
  });
});

describe('a step that fails', () => {
  it('rethrows with retries left, and does not escalate yet', async () => {
    runStep.mockRejectedValue(new Error('firestore is down'));

    await expect(handoverItemsHandler(PAYLOAD, context(1, 5))).rejects.toThrow('firestore is down');

    expect(escalate).not.toHaveBeenCalled();
  });

  it('escalates on the last attempt', async () => {
    const failure = new Error('firestore is still down');

    runStep.mockRejectedValue(failure);

    await expect(handoverItemsHandler(PAYLOAD, context(5, 5))).rejects.toThrow(failure);

    expect(escalate).toHaveBeenCalledWith('match-1', 'handover.items', failure);
  });

  it('still rethrows after escalating, so the job dead-letters', async () => {
    // Both records matter and they say different things: the dead letter is
    // "this job gave up", the escalation is "this handover needs a person, and
    // here is what undoing it would mean".
    runStep.mockRejectedValue(new Error('down'));

    await expect(handoverItemsHandler(PAYLOAD, context(5, 5))).rejects.toThrow('down');
    expect(escalate).toHaveBeenCalledTimes(1);
  });

  it('escalates once, not once per attempt', async () => {
    runStep.mockRejectedValue(new Error('down'));

    await expect(handoverItemsHandler(PAYLOAD, context(3, 5))).rejects.toThrow();
    await expect(handoverItemsHandler(PAYLOAD, context(4, 5))).rejects.toThrow();
    await expect(handoverItemsHandler(PAYLOAD, context(5, 5))).rejects.toThrow();

    expect(escalate).toHaveBeenCalledTimes(1);
  });
});
