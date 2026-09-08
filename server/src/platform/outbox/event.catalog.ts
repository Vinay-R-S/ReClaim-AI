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

export const OUTBOX_EVENTS = ['item.created', 'item.approved'] as const;

export type OutboxEventName = (typeof OUTBOX_EVENTS)[number];

export interface OutboxEventPayloads {
  'item.created': { itemId: string; moderation: 'pending' | 'approved' | 'rejected' };
  'item.approved': { itemId: string };
}

export interface OutboxEvent<N extends OutboxEventName = OutboxEventName> {
  name: N;
  payload: OutboxEventPayloads[N];
}

export const EVENT_VERSIONS: Record<OutboxEventName, number> = {
  'item.created': 1,
  'item.approved': 1,
};

export interface JobDispatch {
  name: JobName;
  payload: JobPayloads[JobName];
  idempotencyKey: string;
}

/**
 * What each event dispatches, or null when nothing consumes it yet.
 *
 * `item.created` on an unapproved report is the case that dispatches nothing:
 * the report is not matchable until an admin approves it, and the approval
 * raises its own event.
 *
 * The idempotency key carries the event id, so redelivery of one event is one
 * run while a later event for the same item is a new one.
 */
export function routeEvent(
  eventId: string,
  name: OutboxEventName,
  payload: Record<string, unknown>,
): JobDispatch | null {
  const itemId = typeof payload.itemId === 'string' ? payload.itemId : null;

  if (!itemId) return null;

  if (name === 'item.created') {
    if (payload.moderation !== 'approved') return null;

    return {
      name: 'match.item',
      payload: { itemId, reason: 'created' },
      idempotencyKey: `match.item:${itemId}:${eventId}`,
    };
  }

  return {
    name: 'match.item',
    payload: { itemId, reason: 'approved' },
    idempotencyKey: `match.item:${itemId}:${eventId}`,
  };
}
