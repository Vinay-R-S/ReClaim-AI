/**
 * What surrounds a handler.
 *
 * A queue delivers at least once, so the claim is what makes a job run once.
 * These pin the three outcomes that matter: the claim holder runs, everybody
 * else stands down, and a failure gives the claim back so the retry is not
 * blocked by the attempt that failed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const { JobRunner } = await import('./job.runner.js');

type ClaimOutcome = Awaited<
  ReturnType<import('../idempotency/idempotency.repository.js').IdempotencyRepository['claim']>
>;

function fakeClaims(outcome: ClaimOutcome = { claimed: true, attempt: 1 }) {
  return {
    claim: vi.fn(async () => outcome),
    complete: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    name: 'match.item' as const,
    payload: { itemId: 'item-1', reason: 'created' as const },
    idempotencyKey: 'match.item:item-1:event-1',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const runnerWith = (handler: any, claims = fakeClaims()) => ({
  runner: new JobRunner({ 'match.item': handler }, claims as any),
  claims,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JobRunner', () => {
  it('runs the handler and completes the claim', async () => {
    const handler = vi.fn(async () => undefined);
    const { runner, claims } = runnerWith(handler);

    const outcome = await runner.run(envelope(), 1, 3);

    expect(outcome).toBe('ran');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(claims.complete).toHaveBeenCalledWith('match.item:item-1:event-1');
    expect(claims.release).not.toHaveBeenCalled();
  });

  it('passes the attempt through, so a handler can tell a retry from a first run', async () => {
    const handler = vi.fn(async () => undefined);
    const { runner } = runnerWith(handler);

    await runner.run(envelope(), 2, 3);

    expect(handler.mock.calls[0][1]).toMatchObject({ attempt: 2, maxAttempts: 3 });
  });

  /** The redelivery case: the work already happened, so it must not happen again. */
  it('skips a key that has already completed', async () => {
    const handler = vi.fn(async () => undefined);
    const { runner, claims } = runnerWith(
      handler,
      fakeClaims({ claimed: false, reason: 'completed' }),
    );

    const outcome = await runner.run(envelope(), 1, 3);

    expect(outcome).toBe('skipped');
    expect(handler).not.toHaveBeenCalled();
    expect(claims.complete).not.toHaveBeenCalled();
  });

  /** Two workers, one job: the one without the lease does nothing and says so. */
  it('skips a key another worker is holding', async () => {
    const handler = vi.fn(async () => undefined);
    const { runner } = runnerWith(handler, fakeClaims({ claimed: false, reason: 'in_flight' }));

    expect(await runner.run(envelope(), 1, 3)).toBe('skipped');
    expect(handler).not.toHaveBeenCalled();
  });

  it('releases the claim and rethrows when the handler fails', async () => {
    const handler = vi.fn(async () => {
      throw new Error('provider is down');
    });
    const { runner, claims } = runnerWith(handler);

    await expect(runner.run(envelope(), 1, 3)).rejects.toThrow('provider is down');
    expect(claims.release).toHaveBeenCalledWith('match.item:item-1:event-1');
    expect(claims.complete).not.toHaveBeenCalled();
  });

  it('claims for longer than the attempt may run, so a slow job keeps its lease', async () => {
    const { runner, claims } = runnerWith(vi.fn(async () => undefined));

    await runner.run(envelope(), 1, 3);

    const leaseMs = claims.claim.mock.calls[0][2] as number;

    expect(leaseMs).toBeGreaterThan(120_000);
  });

  it('continues the producer trace rather than starting a new one', async () => {
    const { getTraceContext } = await import('../tracing/context.js');
    const seen: Array<string | undefined> = [];
    const handler = vi.fn(async () => {
      seen.push(getTraceContext()?.traceId);
    });
    const { runner } = runnerWith(handler);

    await runner.run(envelope(), 1, 3);

    expect(seen).toEqual(['4bf92f3577b34da6a3ce929d0e0e4736']);
  });
});
