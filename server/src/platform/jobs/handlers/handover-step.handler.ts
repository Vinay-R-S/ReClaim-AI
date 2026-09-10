/**
 * The five handover saga steps, as jobs.
 *
 * Thin on purpose: the work is in `services/handover/handover.steps.ts`, and
 * what this layer adds is the one thing only it knows — whether this was the
 * last attempt. A step that fails with retries left should throw and be
 * retried; a step that fails on its last attempt has to escalate, because past
 * the point where the code was accepted the physical handover has already
 * happened and no amount of further retrying changes that.
 */

import { handoverSteps } from '../../../services/handover/handover.steps.js';
import { handoverSagaRepository } from '../../../services/handover/handover.saga.js';
import type { SagaStep } from '../../../services/handover/handover.saga.js';
import type { HandoverStepPayload } from '../job.types.js';
import type { JobContext, JobHandler } from '../queue.port.js';
import type { StepResult } from '../../../services/handover/handover.steps.js';

/**
 * Bind one step to its handler.
 *
 * The escalation happens on the last attempt and the error is rethrown
 * afterwards, so the job still dead-letters. Both records matter and they say
 * different things: the dead letter is "this job gave up", the escalation is
 * "this handover needs a person, and here is what undoing it would mean".
 */
function stepHandler(
  step: SagaStep,
  action: (payload: HandoverStepPayload) => Promise<StepResult>,
): JobHandler<typeof step> {
  return async (payload: HandoverStepPayload, context: JobContext) => {
    try {
      await handoverSteps.runStep(step, payload, action);
    } catch (error) {
      if (context.attempt >= context.maxAttempts) {
        await handoverSagaRepository.escalate(payload.handoverId, step, error);
      }

      throw error;
    }
  };
}

export const handoverItemsHandler = stepHandler('handover.items', (payload) =>
  handoverSteps.moveItems(payload),
);

export const handoverArchiveHandler = stepHandler('handover.archive', (payload) =>
  handoverSteps.archiveMatch(payload),
);

export const handoverCreditsHandler = stepHandler('handover.credits', (payload) =>
  handoverSteps.awardCredits(payload),
);

export const handoverNotifyHandler = stepHandler('handover.notify', (payload) =>
  handoverSteps.notify(payload),
);

export const handoverChainHandler = stepHandler('handover.chain', (payload) =>
  handoverSteps.recordOnChain(payload),
);
