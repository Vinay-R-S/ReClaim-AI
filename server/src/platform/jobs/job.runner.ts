/**
 * What happens around a handler, whichever driver delivered the job.
 *
 * Claim the idempotency key, restore the trace the producer was in, bound the
 * attempt with a timeout, then release or complete the claim. Keeping this out
 * of the drivers is what makes the in-process driver and the Redis driver
 * behave the same way.
 */

import { withTimeout } from '../../utils/async.js';
import { createLogger } from '../../utils/logger.js';
import { continueTrace, runWithTraceContext } from '../tracing/context.js';
import {
  idempotencyRepository,
  type IdempotencyRepository,
} from '../idempotency/idempotency.repository.js';
import { RETRY_POLICIES, type JobEnvelope, type JobName } from './job.types.js';
import type { JobHandler, JobHandlerMap } from './queue.port.js';

const log = createLogger('jobs');

/** Head room over the attempt timeout, so a lease outlives the work it guards. */
const LEASE_MARGIN_MS = 30_000;

export type JobOutcome = 'ran' | 'skipped';

export class JobRunner {
  constructor(
    private readonly handlers: JobHandlerMap,
    private readonly claims: IdempotencyRepository = idempotencyRepository,
  ) {}

  async run(envelope: JobEnvelope, attempt: number, maxAttempts: number): Promise<JobOutcome> {
    const policy = RETRY_POLICIES[envelope.name];
    const trace = continueTrace(envelope.traceparent);

    return runWithTraceContext(trace, async () => {
      const claim = await this.claims.claim(
        envelope.idempotencyKey,
        envelope.name,
        policy.timeoutMs + LEASE_MARGIN_MS,
      );

      if (!claim.claimed) {
        log.info('Job skipped', {
          job: envelope.name,
          key: envelope.idempotencyKey,
          reason: claim.reason,
        });

        return 'skipped';
      }

      const jobLog = log.child(envelope.name);

      try {
        const handler = this.handlers[envelope.name] as JobHandler<JobName>;

        await withTimeout(
          handler(envelope.payload, {
            attempt,
            maxAttempts,
            idempotencyKey: envelope.idempotencyKey,
            log: jobLog,
          }),
          policy.timeoutMs,
          envelope.name,
        );

        await this.claims.complete(envelope.idempotencyKey);
        jobLog.info('Job completed', { attempt });

        return 'ran';
      } catch (error) {
        await this.claims.release(envelope.idempotencyKey);
        jobLog.error('Job failed', { attempt, maxAttempts, error });

        throw error;
      }
    });
  }
}
