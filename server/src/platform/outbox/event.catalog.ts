/**
 * The domain event catalogue.
 *
 * An outbox event is a fact that has already happened, written in the same
 * atomic commit as the state change that made it true. It is not a command:
 * the consumer decides what to do about it, and a consumer that changes its
 * mind does not change the producer.
 *
 * Versioning rule: add fields, never repurpose one. A change that a consumer
 * of the old shape could not read is a new `version`, and the drainer keeps
 * handling both until the last old row has drained.
 */

import type { JobName, JobPayloads } from '../jobs/job.types.js';

export const OUTBOX_EVENTS = ['item.created', 'item.approved', 'handover.verified'] as const;

export type OutboxEventName = (typeof OUTBOX_EVENTS)[number];

export interface OutboxEventPayloads {
  'item.created': { itemId: string; moderation: 'pending' | 'approved' | 'rejected' };
  'item.approved': { itemId: string };
  /**
   * Both parties have done what the policy requires, and the handover is real.
   *
   * A fact, not a command: it says the verification happened, and the five
   * consumers below decide what that means for items, matches, credits, email
   * and the chain. The old code ran all five inline and lost whichever ones
   * came after the first failure.
   */
  'handover.verified': { handoverId: string; lostItemId: string; foundItemId: string };
}

export interface OutboxEvent<N extends OutboxEventName = OutboxEventName> {
  name: N;
  payload: OutboxEventPayloads[N];
}

export const EVENT_VERSIONS: Record<OutboxEventName, number> = {
  'item.created': 1,
  'item.approved': 1,
  'handover.verified': 1,
};

export interface JobDispatch {
  name: JobName;
  payload: JobPayloads[JobName];
  idempotencyKey: string;
}

/**
 * What each event dispatches, or nothing when no consumer wants it yet.
 *
 * A list rather than one job, because an event is a fact and a fact can
 * interest more than one consumer. An item becoming visible both starts a
 * matching run and needs a vector; neither knows about the other, and adding
 * the second did not change the first.
 *
 * `item.created` on an unapproved report is the case that dispatches nothing:
 * the report is not matchable until an admin approves it, and the approval
 * raises its own event. Embedding follows the same gate rather than a looser
 * one, so nothing is spent on a report that is about to be rejected.
 *
 * The idempotency key carries the event id, so redelivery of one event is one
 * run while a later event for the same item is a new one.
 */
export function routeEvent(
  eventId: string,
  name: OutboxEventName,
  payload: Record<string, unknown>,
): JobDispatch[] {
  if (name === 'handover.verified') return routeHandoverVerified(eventId, payload);

  const itemId = typeof payload.itemId === 'string' ? payload.itemId : null;

  if (!itemId) return [];

  if (name === 'item.created' && payload.moderation !== 'approved') return [];

  const reason = name === 'item.created' ? 'created' : 'approved';

  return [
    {
      name: 'embed.item',
      payload: { itemId, reason },
      idempotencyKey: `embed.item:${itemId}:${eventId}`,
    },
    {
      name: 'match.item',
      payload: { itemId, reason },
      idempotencyKey: `match.item:${itemId}:${eventId}`,
    },
  ];
}

/**
 * The five side effects of a completed handover.
 *
 * All five are dispatched from the one fact rather than chained, because they
 * are independent: crediting the finder does not depend on the chain write,
 * and making it depend on one would mean an outage in the slowest step
 * withholding the reward for the fastest. Each is idempotent on
 * `(handoverId, step)`, so redelivery is a no-op and order does not matter.
 *
 * What is ordered is the handover's own state: it reaches `completed` when the
 * steps that must have happened have happened, which the saga decides, not
 * this function.
 */
function routeHandoverVerified(eventId: string, payload: Record<string, unknown>): JobDispatch[] {
  const handoverId = typeof payload.handoverId === 'string' ? payload.handoverId : null;
  const lostItemId = typeof payload.lostItemId === 'string' ? payload.lostItemId : null;
  const foundItemId = typeof payload.foundItemId === 'string' ? payload.foundItemId : null;

  // All three, not just the handover. Coercing a missing item id to an empty
  // string dispatched five jobs anyway, and `items.doc('')` throws on every
  // attempt: the blocking step burned its retries, escalated, and raised an
  // escalation whose stated remedy is to re-run a job that can never succeed.
  if (!handoverId || !lostItemId || !foundItemId) return [];

  const steps: JobName[] = [
    'handover.items',
    'handover.archive',
    'handover.credits',
    'handover.notify',
    'handover.chain',
  ];

  return steps.map((step) => ({
    name: step,
    payload: { handoverId, lostItemId, foundItemId },
    // The event id rather than the handover id alone: a redelivery of this
    // event is the same run, and a genuine second verification after a revert
    // is a new one.
    idempotencyKey: `${step}:${handoverId}:${eventId}`,
  }));
}
