/**
 * The dead-letter record.
 *
 * A job that has exhausted its retries is not allowed to disappear into a log
 * line. It lands here with its payload and its trace id so it can be inspected
 * and, once the cause is fixed, replayed by hand.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { createLogger } from '../../utils/logger.js';
import { parseTraceparent } from '../tracing/context.js';
import type { DeadLetterSink } from './queue.port.js';
import type { JobEnvelope } from './job.types.js';

const log = createLogger('deadletter');

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;

  return typeof error === 'string' ? error : 'Unknown error';
}

export class DeadLetterRepository implements DeadLetterSink {
  constructor(private readonly deadLetters = collections.deadLetters) {}

  async record(envelope: JobEnvelope, error: unknown, attempts: number): Promise<void> {
    const trace = parseTraceparent(envelope.traceparent);

    try {
      await this.deadLetters.add({
        jobName: envelope.name,
        payload: envelope.payload,
        idempotencyKey: envelope.idempotencyKey,
        traceId: trace?.traceId ?? null,
        attempts,
        error: describe(error),
        status: 'open',
        enqueuedAt: envelope.enqueuedAt,
        failedAt: Timestamp.now(),
      });
    } catch (writeError) {
      // Losing the record is bad; taking the worker down with it is worse.
      log.error('Could not write a dead-letter record', {
        jobName: envelope.name,
        error: writeError,
      });
    }
  }
}

export const deadLetterRepository = new DeadLetterRepository();
