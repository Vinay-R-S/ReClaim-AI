/**
 * The outbox drainer, against a fake store and a fake queue.
 *
 * What is worth pinning here is the failure behaviour, not the happy path: an
 * event must be published once even with two drainers running, a publication
 * failure must back off rather than spin, and an event that will never publish
 * must end up somewhere a person can find it instead of being retried forever.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), batch: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const { OutboxDrainer } = await import('./outbox.drainer.js');
const { DEFAULT_DRAINER_OPTIONS } = await import('./outbox.drainer.js');

type Row = {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  attempts: number;
  traceparent: string;
  status: 'pending' | 'published' | 'dead';
  availableAt: Date;
  leased: boolean;
  lastError?: string;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'event-1',
    name: 'item.approved',
    payload: { itemId: 'item-1' },
    attempts: 0,
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    status: 'pending',
    availableAt: new Date(0),
    leased: false,
    ...overrides,
  };
}

/** Enough of the repository to exercise the drainer's decisions. */
function fakeOutbox(rows: Row[]) {
  return {
    rows,
    async listDue() {
      return rows.filter((entry) => entry.status === 'pending' && entry.availableAt <= new Date());
    },
    async lease(id: string) {
      const found = rows.find((entry) => entry.id === id);

      if (!found || found.leased || found.status !== 'pending') return false;

      found.leased = true;

      return true;
    },
    async markPublished(id: string) {
      const found = rows.find((entry) => entry.id === id);
      if (found) found.status = 'published';
    },
    async markFailed(id: string, attempts: number, availableAt: Date, error: string) {
      const found = rows.find((entry) => entry.id === id);

      if (!found) return;

      found.attempts = attempts;
      found.availableAt = availableAt;
      found.leased = false;
      found.status = 'pending';
      found.lastError = error;
    },
    async markDead(id: string, attempts: number) {
      const found = rows.find((entry) => entry.id === id);

      if (!found) return;

      found.status = 'dead';
      found.attempts = attempts;
    },
  } as unknown as ConstructorParameters<typeof OutboxDrainer>[1] & { rows: Row[] };
}

function fakeQueue(behaviour: 'ok' | 'fail' = 'ok') {
  const enqueue = vi.fn(async () => {
    if (behaviour === 'fail') throw new Error('Redis is down');

    return { jobId: 'job-1', accepted: true };
  });

  return { driver: 'inline' as const, enqueue, close: vi.fn() };
}

const OPTIONS = { ...DEFAULT_DRAINER_OPTIONS, maxAttempts: 3 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('drainOnce', () => {
  it('publishes a due event and marks it published', async () => {
    const rows = [row()];
    const outbox = fakeOutbox(rows);
    const queue = fakeQueue();

    const summary = await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(summary.published).toBe(1);
    expect(queue.enqueue).toHaveBeenCalledWith(
      'match.item',
      { itemId: 'item-1', reason: 'approved' },
      expect.objectContaining({ idempotencyKey: 'match.item:item-1:event-1' }),
    );
    expect(rows[0].status).toBe('published');
  });

  it('carries the producer trace into the job', async () => {
    const outbox = fakeOutbox([row()]);
    const queue = fakeQueue();

    await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(queue.enqueue.mock.calls[0][2]).toMatchObject({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
  });

  /**
   * The idempotency key names the job and the event, not the item, so a second
   * approval of the same item is a second run, a redelivery of one event is
   * not, and the two jobs one event dispatches never collide with each other.
   */
  it('keys each event separately', async () => {
    const outbox = fakeOutbox([row(), row({ id: 'event-2' })]);
    const queue = fakeQueue();

    await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    const keys = queue.enqueue.mock.calls.map((call) => call[2].idempotencyKey);

    expect(keys).toEqual([
      'embed.item:item-1:event-1',
      'match.item:item-1:event-1',
      'embed.item:item-1:event-2',
      'match.item:item-1:event-2',
    ]);
  });

  /**
   * One fact, two consumers. An item becoming visible both needs a vector and
   * starts a matching run, and neither knows the other exists. It is still one
   * outbox row, published once.
   */
  it('dispatches every job an event interests, as one publication', async () => {
    const rows = [row()];
    const outbox = fakeOutbox(rows);
    const queue = fakeQueue();

    const summary = await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(queue.enqueue.mock.calls.map((call) => call[0])).toEqual(['embed.item', 'match.item']);
    expect(queue.enqueue).toHaveBeenCalledWith(
      'embed.item',
      { itemId: 'item-1', reason: 'approved' },
      expect.objectContaining({ idempotencyKey: 'embed.item:item-1:event-1' }),
    );
    expect(summary.published).toBe(1);
    expect(rows[0].status).toBe('published');
  });

  /** A report awaiting review is not embedded either: it may be rejected. */
  it('embeds nothing for an item that still needs review', async () => {
    const outbox = fakeOutbox([
      row({ name: 'item.created', payload: { itemId: 'item-1', moderation: 'pending' } }),
    ]);
    const queue = fakeQueue();

    await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('leaves an event another drainer holds alone', async () => {
    const outbox = fakeOutbox([row({ leased: true })]);
    const queue = fakeQueue();

    const summary = await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(summary).toMatchObject({ published: 0, skipped: 1 });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  /**
   * A report that still needs review is not matchable, so its creation event
   * dispatches nothing. It is still published: an event nobody consumes is a
   * fact about the catalogue, and retrying it forever would be a busy loop.
   */
  it('publishes an event that has no consumer without queueing anything', async () => {
    const rows = [
      row({ name: 'item.created', payload: { itemId: 'item-1', moderation: 'pending' } }),
    ];
    const outbox = fakeOutbox(rows);
    const queue = fakeQueue();

    const summary = await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(summary.published).toBe(1);
    expect(rows[0].status).toBe('published');
  });

  it('queues an admin-created item straight away, because approval is implied', async () => {
    const outbox = fakeOutbox([
      row({ name: 'item.created', payload: { itemId: 'item-9', moderation: 'approved' } }),
    ]);
    const queue = fakeQueue();

    await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(queue.enqueue).toHaveBeenCalledWith(
      'match.item',
      { itemId: 'item-9', reason: 'created' },
      expect.anything(),
    );
  });

  it('backs off a failed publication instead of retrying it in the same pass', async () => {
    const rows = [row()];
    const outbox = fakeOutbox(rows);
    const queue = fakeQueue('fail');

    const summary = await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(summary.failed).toBe(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('dead-letters an event that has used its attempts', async () => {
    const rows = [row({ attempts: 2 })];
    const outbox = fakeOutbox(rows);

    const summary = await new OutboxDrainer(fakeQueue('fail'), outbox, OPTIONS).drainOnce();

    expect(summary.failed).toBe(1);
    expect(rows[0].status).toBe('dead');
    expect(rows[0].attempts).toBe(3);
  });

  it('leaves an event that is backing off until its time comes', async () => {
    const rows = [row({ availableAt: new Date(Date.now() + 60_000) })];
    const outbox = fakeOutbox(rows);
    const queue = fakeQueue();

    const summary = await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(summary).toMatchObject({ published: 0, failed: 0, skipped: 0 });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('keeps going after one event fails, so a poison row cannot block the rest', async () => {
    const rows = [row(), row({ id: 'event-2', payload: { itemId: 'item-2' } })];
    const outbox = fakeOutbox(rows);
    const queue = {
      driver: 'inline' as const,
      close: vi.fn(),
      enqueue: vi
        .fn()
        .mockRejectedValueOnce(new Error('Redis is down'))
        .mockResolvedValueOnce({ jobId: 'job-2', accepted: true }),
    };

    const summary = await new OutboxDrainer(queue, outbox, OPTIONS).drainOnce();

    expect(summary).toMatchObject({ published: 1, failed: 1 });
    expect(rows[1].status).toBe('published');
  });
});
