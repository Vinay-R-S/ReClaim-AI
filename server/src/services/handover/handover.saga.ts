/**
 * The handover completion saga (PLAN.md section 10.2 and the table in 10.3).
 *
 * Completing a handover has five side effects: the two item documents, the
 * match record, the credit awards, the emails and the chain attestation. The
 * old code did them inline — a batch plus three fire-and-forget blocks — so a
 * failure anywhere past the batch left the system disagreeing with itself
 * about whether the handover had happened, with nothing recording that it had
 * half happened.
 *
 * Now each is a job of its own, dispatched from the one `handover.verified`
 * fact. Three properties make that safe:
 *
 * **Idempotent.** Every step records itself at `handoverSteps/{handoverId}:{step}`
 * before it is considered done, and checks that row before it starts. A
 * redelivered job is a read and a return.
 *
 * **Compensable.** Every step declares how to undo itself. Nothing in this
 * phase calls the compensations — the admin revert that drives them is phase
 * 27 — but they are declared here, next to the forward action, because a
 * compensation written six months later in another file is a compensation
 * that does not match what it is undoing.
 *
 * **Escalating.** A step that exhausts its retries does not retry forever and
 * does not vanish into a log. It writes an escalation for a person, because
 * past the point where the code was accepted the physical handover has already
 * happened and no amount of retrying changes that.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { createLogger } from '../../utils/logger.js';
import type { JobName } from '../../platform/jobs/job.types.js';

const log = createLogger('handover:saga');

/** The five steps, in the order the table in section 10.3 numbers them. */
export const SAGA_STEPS = [
  'handover.items',
  'handover.archive',
  'handover.credits',
  'handover.notify',
  'handover.chain',
] as const;

export type SagaStep = (typeof SAGA_STEPS)[number];

export function isSagaStep(name: JobName): name is SagaStep {
  return (SAGA_STEPS as readonly string[]).includes(name);
}

/**
 * What undoing a step means.
 *
 * Written down rather than implied, because three of the five cannot be undone
 * by deleting anything and a reader who assumes they can will write the wrong
 * revert. Credits are a ledger: the compensation is a reversing entry, never
 * an edit. The chain is append-only: the compensation is a revocation record
 * that references the original transaction. An email cannot be recalled: the
 * compensation is a correction notice.
 */
export interface StepDefinition {
  step: SagaStep;
  /** What it does, in one line, for the escalation an admin reads. */
  forward: string;
  /** How it is undone. Driven by the revert flow in phase 27. */
  compensation: string;
  /**
   * Whether failing this step should hold the handover short of `completed`.
   *
   * Only the two that decide what the system believes about the objects
   * themselves. A late email or a late attestation is a late email or a late
   * attestation; the handover still happened, and refusing to record it
   * because a third party is down would be the system lying about the world to
   * protect its own bookkeeping.
   */
  blocksCompletion: boolean;
}

export const STEP_DEFINITIONS: Record<SagaStep, StepDefinition> = {
  'handover.items': {
    step: 'handover.items',
    forward: 'Set both items to Claimed',
    compensation: 'Restore the prior status of both items from the event log',
    blocksCompletion: true,
  },
  'handover.archive': {
    step: 'handover.archive',
    forward: 'Archive the match to history',
    compensation: 'Restore the active match record from the archived copy',
    blocksCompletion: true,
  },
  'handover.credits': {
    step: 'handover.credits',
    forward: 'Award credits to both parties',
    compensation: 'Post reversing ledger entries. Never edit or delete the originals',
    blocksCompletion: false,
  },
  'handover.notify': {
    step: 'handover.notify',
    forward: 'Email both parties that the handover is complete',
    compensation: 'Send a correction notice to both parties',
    blocksCompletion: false,
  },
  'handover.chain': {
    step: 'handover.chain',
    forward: 'Write the chain attestation',
    compensation: 'Write a linked revocation record referencing the original transaction',
    blocksCompletion: false,
  },
};

function stepId(handoverId: string, step: SagaStep): string {
  return `${handoverId}:${step}`;
}

export interface StepRecord {
  handoverId: string;
  step: SagaStep;
  status: 'started' | 'done' | 'skipped' | 'escalated';
  detail?: string;
  /**
   * What the compensation will need.
   *
   * Captured by the forward step, because most of it stops being readable once
   * the step has run: "restore the prior status" needs the prior status, and
   * the item document no longer has it.
   */
  undo?: Record<string, unknown>;
}

export class HandoverSagaRepository {
  constructor(
    private readonly steps = collections.handoverSteps,
    private readonly escalations = collections.escalations,
  ) {}

  /** Whether this step has already run for this handover. */
  async isDone(handoverId: string, step: SagaStep): Promise<boolean> {
    const snapshot = await this.steps.doc(stepId(handoverId, step)).get();

    if (!snapshot.exists) return false;

    const status = (snapshot.data() as StepRecord).status;

    // `escalated` is not done. It is a step that gave up and is waiting for a
    // person, and an admin who fixes the cause re-runs it. Neither is
    // `started`: that row exists only to hold what a compensation will need,
    // written before the work so a crash cannot lose it.
    return status === 'done' || status === 'skipped';
  }

  /**
   * Record what undoing this step will need, before the step runs.
   *
   * The compensations are described in terms of state the forward action is
   * about to destroy: "restore the prior status of both items" needs the prior
   * status, and the item documents stop carrying it the moment the step
   * commits. Capturing it afterwards works only if nothing goes wrong in
   * between — and a worker dying between the write and the acknowledgement is
   * the normal case for at-least-once delivery, not the exotic one. On
   * redelivery the capture would then read the values the first run already
   * wrote, and the compensation would restore `Claimed` to `Claimed`.
   *
   * Written only once. A redelivery finds the row and leaves the original
   * capture alone.
   */
  async begin(handoverId: string, step: SagaStep, undo: Record<string, unknown>): Promise<void> {
    const ref = this.steps.doc(stepId(handoverId, step));

    await this.steps.firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);

      if (snapshot.exists) return;

      tx.set(ref, {
        handoverId,
        step,
        status: 'started',
        undo,
        startedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  /** What a previous attempt captured, for a step that is being retried. */
  async capturedUndo(handoverId: string, step: SagaStep): Promise<Record<string, unknown> | null> {
    const snapshot = await this.steps.doc(stepId(handoverId, step)).get();

    if (!snapshot.exists) return null;

    const undo = (snapshot.data() as StepRecord).undo;

    return undo ?? null;
  }

  /**
   * Mark a step finished.
   *
   * Merged, and `undo` is omitted when the caller has none to add, so a
   * completion cannot overwrite what `begin` captured before the work ran.
   */
  async markDone(record: StepRecord): Promise<void> {
    const { undo, ...rest } = record;

    await this.steps.doc(stepId(record.handoverId, record.step)).set(
      {
        ...rest,
        ...(undo ? { undo } : {}),
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  /** Which steps have finished, for deciding whether the handover is complete. */
  async completed(handoverId: string): Promise<Set<SagaStep>> {
    const snapshot = await this.steps.where('handoverId', '==', handoverId).get();

    return new Set(
      snapshot.docs
        .map((doc) => doc.data() as StepRecord)
        .filter((record) => record.status === 'done' || record.status === 'skipped')
        .map((record) => record.step),
    );
  }

  /**
   * A step that gave up, written where a person will find it.
   *
   * The compensation is on the row rather than in a runbook, because the
   * person reading it at two in the morning is deciding what to do about a
   * handover that has already physically happened.
   */
  async escalate(handoverId: string, step: SagaStep, error: unknown): Promise<void> {
    const definition = STEP_DEFINITIONS[step];
    const message = error instanceof Error ? error.message : String(error);

    log.error('Saga step gave up and was escalated', { handoverId, step, error });

    await Promise.all([
      this.steps.doc(stepId(handoverId, step)).set(
        { handoverId, step, status: 'escalated', detail: message, escalatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      ),
      this.escalations.doc(stepId(handoverId, step)).set({
        kind: 'handover_step_failed',
        handoverId,
        step,
        forward: definition.forward,
        compensation: definition.compensation,
        blocksCompletion: definition.blocksCompletion,
        error: message,
        resolved: false,
        raisedAt: FieldValue.serverTimestamp(),
      }),
    ]);
  }
}

export const handoverSagaRepository = new HandoverSagaRepository();

/** The steps that must finish before a handover may be called complete. */
export const BLOCKING_STEPS: SagaStep[] = SAGA_STEPS.filter(
  (step) => STEP_DEFINITIONS[step].blocksCompletion,
);
