/**
 * The in-process driver.
 *
 * It is what runs on a machine with no Redis, so it has to behave like the
 * Redis one in every way a caller can observe: enqueueing never blocks the
 * caller, a failure is retried to the policy, and the last failure is recorded
 * rather than logged and forgotten.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const handler = vi.fn(async () => undefined);

vi.mock('./handlers/index.js', () => ({ jobHandlers: { 'match.item': handler } }));

const claim = vi.fn(async () => ({ claimed: true, attempt: 1 }));

vi.mock('../idempotency/idempotency.repository.js', () => ({
  IdempotencyRepository: class {},
  idempotencyRepository: {
    claim: (...args: unknown[]) => claim(...(args as [])),
    complete: async () => undefined,
    release: async () => undefined,
  },
}));

const { InlineJobQueue } = await import('./inline.queue.js');

/** The real policy waits ten seconds between attempts, which no test should. */
const FAST = {
  'match.item': { attempts: 3, backoffMs: 1, timeoutMs: 1_000 },
} as const;

function sink() {
  return { record: vi.fn(async () => undefined) };
}

beforeEach(() => {
  vi.clearAllMocks();
  claim.mockImplementation(async () => ({ claimed: true, attempt: 1 }));
});

describe('InlineJobQueue', () => {
  it('accepts a job and runs it without the caller waiting for it', async () => {
    const queue = new InlineJobQueue(sink(), FAST);
    let finished = false;

    handler.mockImplementation(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      finished = true;
    });

    const result = await queue.enqueue('match.item', { itemId: 'item-1', reason: 'created' });

    expect(result.accepted).toBe(true);
    expect(finished).toBe(false);

    await queue.whenIdle();

    expect(finished).toBe(true);
  });

  it('carries the payload through to the handler', async () => {
    const queue = new InlineJobQueue(sink(), FAST);

    await queue.enqueue('match.item', { itemId: 'item-7', reason: 'rematch' });
    await queue.whenIdle();

    expect(handler.mock.calls[0][0]).toEqual({ itemId: 'item-7', reason: 'rematch' });
  });

  it('uses the caller idempotency key, and invents one when there is none', async () => {
    const queue = new InlineJobQueue(sink(), FAST);

    await queue.enqueue(
      'match.item',
      { itemId: 'a', reason: 'created' },
      { idempotencyKey: 'k-1' },
    );
    await queue.enqueue('match.item', { itemId: 'b', reason: 'created' });
    await queue.whenIdle();

    expect(claim.mock.calls[0][0]).toBe('k-1');
    expect(claim.mock.calls[1][0]).toMatch(/^match\.item:[0-9a-f-]{36}$/);
  });

  it('retries a failing job up to the policy', async () => {
    const queue = new InlineJobQueue(sink(), FAST);

    handler.mockRejectedValueOnce(new Error('flaky')).mockResolvedValueOnce(undefined);

    await queue.enqueue('match.item', { itemId: 'item-1', reason: 'created' });
    await queue.whenIdle();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('dead-letters a job that fails every attempt', async () => {
    const deadLetters = sink();
    const queue = new InlineJobQueue(deadLetters, FAST);

    handler.mockRejectedValue(new Error('provider is down'));

    await queue.enqueue(
      'match.item',
      { itemId: 'item-1', reason: 'created' },
      { idempotencyKey: 'k-2' },
    );
    await queue.whenIdle();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(deadLetters.record).toHaveBeenCalledTimes(1);
    expect(deadLetters.record.mock.calls[0][0]).toMatchObject({
      name: 'match.item',
      idempotencyKey: 'k-2',
    });
  });

  /**
   * A handler failure must never surface as an unhandled rejection: the caller
   * has already been answered, and an unhandled rejection takes the process
   * down with it.
   */
  it('does not reject the enqueue when the job fails', async () => {
    const queue = new InlineJobQueue(sink(), FAST);

    handler.mockRejectedValue(new Error('provider is down'));

    await expect(
      queue.enqueue('match.item', { itemId: 'item-1', reason: 'created' }),
    ).resolves.toMatchObject({ accepted: true });
    await expect(queue.whenIdle()).resolves.toBeUndefined();
  });

  it('does not run a job whose key has already completed', async () => {
    const queue = new InlineJobQueue(sink(), FAST);

    claim.mockImplementation(async () => ({ claimed: false, reason: 'completed' }));

    await queue.enqueue('match.item', { itemId: 'item-1', reason: 'created' });
    await queue.whenIdle();

    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses new work once closed, and waits for what is running', async () => {
    const queue = new InlineJobQueue(sink(), FAST);

    handler.mockImplementation(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });

    await queue.enqueue('match.item', { itemId: 'item-1', reason: 'created' });
    await queue.close();

    expect(handler).toHaveBeenCalledTimes(1);

    const afterClose = await queue.enqueue('match.item', { itemId: 'item-2', reason: 'created' });

    expect(afterClose.accepted).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
