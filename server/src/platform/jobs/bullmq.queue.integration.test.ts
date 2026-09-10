/**
 * The Redis driver against a real Redis.
 *
 * Skipped when `REDIS_URL` is unset, so the suite still runs on a machine with
 * no Docker; CI sets it. What it proves is the part a fake cannot: that the
 * enqueue really lands in Redis, that a duplicate key is refused by the queue
 * rather than by the handler, and that a worker picks the job up and runs it
 * with the producer's trace still attached.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const claim = vi.fn(async () => ({ claimed: true, attempt: 1 }));

vi.mock('../idempotency/idempotency.repository.js', () => ({
  IdempotencyRepository: class {},
  idempotencyRepository: {
    claim: (...args: unknown[]) => claim(...(args as [])),
    complete: async () => undefined,
    release: async () => undefined,
  },
}));

const REDIS_URL = process.env.REDIS_URL;

const { BullMqJobQueue, queueNameFor, toJobId } = await import('./bullmq.queue.js');
const { BullMqJobWorker } = await import('./bullmq.worker.js');
const { JobRunner } = await import('./job.runner.js');
const { createRedisConnection } = await import('./redis.connection.js');
const { whenReady } = await import('../redis/ready.js');
const { getTraceContext } = await import('../tracing/context.js');

describe.skipIf(!REDIS_URL)('BullMQ driver', () => {
  const url = REDIS_URL as string;
  let queue: InstanceType<typeof BullMqJobQueue>;
  let worker: InstanceType<typeof BullMqJobWorker> | null = null;

  beforeAll(async () => {
    // A run must not inherit jobs left by the previous one.
    const admin = createRedisConnection(url, 'producer');

    // A producer connection does not buffer, so the first command has to wait
    // for the socket. Without this the cleanup below raced the handshake and
    // failed the whole suite with "Stream isn't writeable" on a CI runner that
    // had Redis up and healthy.
    await whenReady(admin);

    const keys = await admin.keys(`bull:${queueNameFor('match.item')}:*`);

    if (keys.length > 0) await admin.del(...keys);

    await admin.quit();

    queue = new BullMqJobQueue(createRedisConnection(url, 'producer'));
  });

  // Optional chaining on both: a `beforeAll` that threw leaves them unset, and
  // a teardown that then throws its own TypeError reports a second failure for
  // the same cause and hides the first.
  afterAll(async () => {
    await worker?.stop();

    if (queue) await queue.close();
  });

  it('accepts a job and refuses the same idempotency key twice', async () => {
    const key = `match.item:item-1:${Date.now()}`;

    const first = await queue.enqueue(
      'match.item',
      { itemId: 'item-1', reason: 'created' },
      {
        idempotencyKey: key,
        delayMs: 60_000,
      },
    );
    const second = await queue.enqueue(
      'match.item',
      { itemId: 'item-1', reason: 'created' },
      {
        idempotencyKey: key,
        delayMs: 60_000,
      },
    );

    expect(first).toEqual({ jobId: toJobId(key), accepted: true });
    expect(second).toEqual({ jobId: toJobId(key), accepted: false });
  });

  it('delivers a job to a worker with the producer trace attached', async () => {
    const seen: Array<{ itemId: string; traceId?: string }> = [];

    const handler = vi.fn(async (payload: { itemId: string }) => {
      seen.push({ itemId: payload.itemId, traceId: getTraceContext()?.traceId });
    });

    worker = new BullMqJobWorker(
      createRedisConnection(url, 'consumer'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new JobRunner({ 'match.item': handler as any }),
      1,
    );

    await worker.start();

    await queue.enqueue(
      'match.item',
      { itemId: 'item-live', reason: 'approved' },
      {
        idempotencyKey: `match.item:item-live:${Date.now()}`,
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    );

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 10_000 });

    expect(seen[0]).toEqual({
      itemId: 'item-live',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });
  }, 20_000);
});
