/**
 * What each saga step actually does.
 *
 * The forward halves of the table in PLAN.md 10.3, one function each. The
 * platform layer binds them to job names; nothing here knows about queues,
 * retries or Redis, which is what lets each of them be tested by calling it.
 *
 * Every one of them is idempotent, and each in its own way rather than by a
 * shared trick: the item write is a set to a fixed value, the archive is keyed
 * on the match id, credits carry their own idempotency key into the ledger,
 * and email and the chain are guarded by the step record. The guard is checked
 * by the runner in `runStep`, so a handler that forgets is still safe.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { handoverRepository, HandoverRepository } from '../../repositories/handover.repository.js';
import { userRepository } from '../../repositories/user.repository.js';
import { createLogger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { sendHandoverCompletedNotice } from '../email.service.js';
import type { Item } from '../../types/index.js';
import {
  BLOCKING_STEPS,
  handoverSagaRepository,
  HandoverSagaRepository,
  STEP_DEFINITIONS,
  type SagaStep,
} from './handover.saga.js';
import { handoverMachine, HandoverMachine, stateOf } from './handover.machine.js';
import type { HandoverState } from './handover.states.js';
import type { HandoverStepPayload } from '../../platform/jobs/job.types.js';

const log = createLogger('handover:steps');

/** What a step returns: whether it did work, and what to record for the undo. */
export interface StepResult {
  status: 'done' | 'skipped';
  detail?: string;
  /** Recorded on the step row so a compensation has the prior values. */
  undo?: Record<string, unknown>;
}

function itemSnapshot(item: Item | null) {
  return {
    name: item?.name || null,
    description: item?.description || null,
    location: item?.location || null,
    date: item?.date || null,
    color: item?.color || null,
    category: item?.category || null,
    tags: item?.tags || null,
    imageUrl: item?.imageUrl || item?.cloudinaryUrls?.[0] || null,
  };
}

async function loadUser(userId?: string | null) {
  if (!userId) return null;

  const user = await userRepository.findById(userId);

  return (user as { email?: string; displayName?: string; role?: string } | null) ?? null;
}

export class HandoverSteps {
  constructor(
    private readonly saga: HandoverSagaRepository = handoverSagaRepository,
    private readonly machine: HandoverMachine = handoverMachine,
    private readonly handovers: HandoverRepository = handoverRepository,
    private readonly items = collections.items,
  ) {}

  /**
   * Step 2: both items become Claimed.
   *
   * The prior status of each is recorded for the compensation, which is the
   * whole reason this is not a blind write: "restore the prior status" needs
   * somewhere to have kept it, and the item document will not have it once
   * this has run.
   */
  async moveItems(payload: HandoverStepPayload): Promise<StepResult> {
    const [lost, found] = await Promise.all([
      this.items.doc(payload.lostItemId).get(),
      this.items.doc(payload.foundItemId).get(),
    ]);

    const present = [lost, found].filter((doc) => doc.exists);

    if (present.length === 0) {
      // Both gone. A handover of items that no longer exist is still a fact
      // worth recording, so this is a skip and not a failure.
      return { status: 'skipped', detail: 'neither item still exists' };
    }

    // Captured before the write, because the write is what destroys it. A
    // redelivery after a crash would otherwise read `Claimed` on both sides
    // and record that as the status to restore.
    await this.saga.begin(payload.handoverId, 'handover.items', {
      priorStatus: {
        [payload.lostItemId]: (lost.data() as Item | undefined)?.status ?? null,
        [payload.foundItemId]: (found.data() as Item | undefined)?.status ?? null,
      },
    });

    const batch = this.items.firestore.batch();

    present.forEach((doc) => {
      batch.update(doc.ref, { status: 'Claimed', updatedAt: FieldValue.serverTimestamp() });
    });

    await batch.commit();

    return { status: 'done' };
  }

  /**
   * Step 3: the match is archived and the handover record written.
   *
   * The record is built from whatever survives rather than skipped when
   * something is missing: a handover that happened is worth recording even
   * when one of its items has since been deleted.
   */
  async archiveMatch(payload: HandoverStepPayload): Promise<StepResult> {
    const context = await this.handovers.loadCompletionContext(
      payload.handoverId,
      payload.lostItemId,
      payload.foundItemId,
    );
    const { lostItem, foundItem, matchData } = context;

    if (!lostItem || !foundItem) {
      log.warn('Archiving a handover with a missing item document', {
        handoverId: payload.handoverId,
        lostItemExists: context.lostItemExists,
        foundItemExists: context.foundItemExists,
      });
    }

    const [lostUser, foundUser, stored] = await Promise.all([
      loadUser(lostItem?.reportedBy),
      loadUser(foundItem?.reportedBy),
      this.handovers.findSessionByMatch(payload.handoverId),
    ]);

    const record = {
      matchId: payload.handoverId,
      lostItemId: payload.lostItemId,
      foundItemId: payload.foundItemId,
      lostPersonId: lostItem?.reportedBy || null,
      foundPersonId: foundItem?.reportedBy || null,

      // The pair again, as an array, so "the handovers this person took part
      // in" is an indexed `array-contains` rather than a read of every
      // completed handover followed by an in-memory filter (defect PERF-03).
      participantIds: [lostItem?.reportedBy, foundItem?.reportedBy].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),

      matchScore: matchData?.matchScore ?? lostItem?.matchScore ?? foundItem?.matchScore ?? 0,
      matchCreatedAt: matchData?.createdAt || null,

      lostItemDetails: itemSnapshot(lostItem),
      foundItemDetails: {
        ...itemSnapshot(foundItem),
        collectionPoint: foundItem?.collectionPoint || null,
      },

      lostPersonDetails: {
        userId: lostItem?.reportedBy || null,
        email: lostItem?.reportedByEmail || lostUser?.email || null,
        displayName: lostUser?.displayName || null,
      },
      foundPersonDetails: {
        userId: foundItem?.reportedBy || null,
        email: foundItem?.reportedByEmail || foundUser?.email || null,
        displayName: foundUser?.displayName || null,
      },

      // The hash of the code that was actually accepted. The code document
      // can be re-issued, which overwrites `codeHash` there, so this is the
      // copy that survives to answer "which credential closed this handover"
      // when somebody disputes it.
      verificationCode: (stored?.codeHash as string | undefined) ?? null,

      handoverTime: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      status: 'completed',
    };

    // Same reason as the item step: this deletes the active match, so whether
    // there was one to restore stops being readable the moment it commits.
    // `matchScore` is kept for the chain step, which runs concurrently and
    // would otherwise read a match this has already deleted.
    await this.saga.begin(payload.handoverId, 'handover.archive', {
      hadActiveMatch: Boolean(matchData),
      matchScore: record.matchScore,
    });

    await this.handovers.archiveOnCompletion({
      matchId: payload.handoverId,
      codeDocRef: await this.handovers.resolveCodeRefById(payload.handoverId),
      record,
      matchData,
    });

    return { status: 'done' };
  }

  /**
   * Step 4: credits to both parties.
   *
   * Admins are skipped: they submit on behalf of other people, and paying them
   * for it turns the review queue into an income. The ledger's own idempotency
   * key is what makes a retry safe, not this step's record.
   */
  async awardCredits(payload: HandoverStepPayload): Promise<StepResult> {
    const context = await this.handovers.loadCompletionContext(
      payload.handoverId,
      payload.lostItemId,
      payload.foundItemId,
    );

    const lostUserId = context.lostItem?.reportedBy;
    const foundUserId = context.foundItem?.reportedBy;

    if (!lostUserId || !foundUserId) {
      return { status: 'skipped', detail: 'one side has no reporter on record' };
    }

    const [lostUser, foundUser] = await Promise.all([loadUser(lostUserId), loadUser(foundUserId)]);
    const { awardOwnerCredits, awardFinderCredits } = await import('../credits.service.js');

    const awarded: string[] = [];

    if (lostUser?.role !== 'admin') {
      const result = await awardOwnerCredits(lostUserId, payload.lostItemId);

      if (!result.success) throw new Error(`Owner credit award failed for ${payload.handoverId}`);

      awarded.push('owner');
    }

    if (foundUser?.role !== 'admin') {
      const result = await awardFinderCredits(foundUserId, payload.foundItemId);

      if (!result.success) throw new Error(`Finder credit award failed for ${payload.handoverId}`);

      awarded.push('finder');
    }

    return { status: 'done', undo: { awarded } };
  }

  /**
   * Step 6: tell both parties it is done.
   *
   * Each is written to on their own, with nothing about the other person in
   * it. The code-issue email discloses the finder's address to the owner and
   * sends two strangers to meet (defect SEC-22); that is phase 29's to fix,
   * and this is not going to add a second instance of it in the meantime.
   */
  async notify(payload: HandoverStepPayload): Promise<StepResult> {
    const context = await this.handovers.loadCompletionContext(
      payload.handoverId,
      payload.lostItemId,
      payload.foundItemId,
    );

    const itemName = context.lostItem?.name || context.foundItem?.name || 'your item';

    const [lostUser, foundUser] = await Promise.all([
      loadUser(context.lostItem?.reportedBy),
      loadUser(context.foundItem?.reportedBy),
    ]);

    const recipients = [
      context.lostItem?.reportedByEmail || lostUser?.email,
      context.foundItem?.reportedByEmail || foundUser?.email,
    ].filter((value): value is string => Boolean(value));

    if (recipients.length === 0) {
      return { status: 'skipped', detail: 'no address on either side' };
    }

    const sent = await Promise.all(
      recipients.map((recipient) => sendHandoverCompletedNotice(recipient, itemName)),
    );

    if (sent.some((ok) => !ok)) {
      throw new Error(`Handover completion email failed for ${payload.handoverId}`);
    }

    return { status: 'done', undo: { notified: recipients.length } };
  }

  /**
   * Step 5: the chain attestation.
   *
   * Optional by configuration, and the slowest of the five. A handover is not
   * less true because the attestation is late, which is why this does not
   * block completion.
   */
  async recordOnChain(payload: HandoverStepPayload): Promise<StepResult> {
    if (!env.blockchain.enabled) return { status: 'skipped', detail: 'blockchain disabled' };

    const context = await this.handovers.loadCompletionContext(
      payload.handoverId,
      payload.lostItemId,
      payload.foundItemId,
    );
    const { recordHandoverOnBlockchain } = await import('../blockchain.service.js');

    const result = await recordHandoverOnBlockchain({
      matchId: payload.handoverId,
      lostItemId: payload.lostItemId,
      foundItemId: payload.foundItemId,
      lostPersonId: context.lostItem?.reportedBy || '',
      foundPersonId: context.foundItem?.reportedBy || '',
      itemDetails: {
        lostItemName: context.lostItem?.name || '',
        foundItemName: context.foundItem?.name || '',
        location: context.foundItem?.collectionPoint || context.foundItem?.location || '',
        // The archive step deletes the active match and the five steps run
        // concurrently, so reading the score from the match alone recorded a
        // permanent zero on the chain whenever archive won the race. The
        // captured value is what archive saw before it deleted anything.
        matchScore: await this.matchScoreFor(payload, context.matchData),
      },
    });

    if (!result.success) throw new Error(result.error || 'chain write failed');

    await this.handovers.recordChainAttestation(payload.handoverId, result.txHash as string);

    return { status: 'done', undo: { txHash: result.txHash } };
  }

  /** Where the handover is now, for a step deciding whether to run at all. */
  private async stateOfHandover(handoverId: string): Promise<HandoverState> {
    const ref = await this.handovers.resolveCodeRefById(handoverId);
    const snapshot = await ref.get();

    return stateOf(snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined);
  }

  /**
   * The score to attest to, whether or not the match still exists.
   *
   * Falls back through the archive step's capture and then the handover record
   * itself, both of which outlive the match document.
   */
  private async matchScoreFor(
    payload: HandoverStepPayload,
    matchData: Record<string, unknown> | null,
  ): Promise<number> {
    const live = matchData?.matchScore;

    if (typeof live === 'number') return live;

    const captured = await this.saga.capturedUndo(payload.handoverId, 'handover.archive');
    const score = captured?.matchScore;

    return typeof score === 'number' ? score : 0;
  }

  /**
   * Run one step, once.
   *
   * The idempotency check, the record and the completion test live here rather
   * than in each handler, so a step added later cannot forget any of them.
   * A throw is left to propagate: the job runner owns retries, and the last
   * failed attempt is what escalates.
   */
  async runStep(
    step: SagaStep,
    payload: HandoverStepPayload,
    action: (payload: HandoverStepPayload) => Promise<StepResult>,
  ): Promise<void> {
    // A handover that has been reverted or is under dispute must not have its
    // forward steps run, whatever the step rows say. Three of the five do not
    // block completion, so a handover can reach `completed` — and then be
    // reverted — while one of them is still retrying or waiting on an
    // operator. Re-running it afterwards awards credits on a reverted
    // handover, emails "completed" after the correction notice, or attests a
    // handover that has just been revoked.
    const state = await this.stateOfHandover(payload.handoverId);

    if (state === 'reverted' || state === 'disputed') {
      log.warn('Skipping a saga step: the handover is no longer settled', {
        handoverId: payload.handoverId,
        step,
        state,
      });

      return;
    }

    if (await this.saga.isDone(payload.handoverId, step)) {
      log.info('Saga step already done', { handoverId: payload.handoverId, step });

      // Still tested. The completion check runs after the work, so anything
      // that threw between marking a step done and moving the handover — a
      // transient Firestore error, a lost lease — used to be unrecoverable:
      // the redelivered job returned here, reported success, and the handover
      // sat at `verified` forever with no dead letter and nothing in the log.
      await this.completeIfReady(payload);

      return;
    }

    const result = await action(payload);

    await this.saga.markDone({
      handoverId: payload.handoverId,
      step,
      status: result.status,
      ...(result.detail ? { detail: result.detail } : {}),
      ...(result.undo ? { undo: result.undo } : {}),
    });

    log.info('Saga step finished', {
      handoverId: payload.handoverId,
      step,
      status: result.status,
      forward: STEP_DEFINITIONS[step].forward,
    });

    await this.completeIfReady(payload);
  }

  /**
   * Move the handover to `completed` once the steps that must have happened
   * have happened.
   *
   * Whichever step finishes last does this, so there is no coordinator to keep
   * alive and no ordering between the five. The transition is idempotent by
   * construction: `completed` has no `complete` edge out of the table, so the
   * second caller is refused rather than writing a second event.
   */
  private async completeIfReady(payload: HandoverStepPayload): Promise<void> {
    const done = await this.saga.completed(payload.handoverId);

    if (!BLOCKING_STEPS.every((step) => done.has(step))) return;

    const ref = await this.handovers.resolveCodeRefById(payload.handoverId);
    const outcome = await this.machine.apply(ref, {
      matchId: payload.handoverId,
      transition: 'complete',
      actor: null,
      actorRole: 'system',
      reason: 'every blocking saga step finished',
      metadata: { steps: [...done] },
      // Only from `verified`. The table also allows `disputed -> completed`,
      // for a dispute an admin did not uphold, and that decision is a person's
      // to make: without this, an operator re-running an escalated step after
      // the owner disputed would have a worker close the dispute in the
      // platform's favour and record it as a system action.
      expect: ['verified'],
    });

    if (outcome.ok) {
      log.info('Handover completed', { handoverId: payload.handoverId });

      return;
    }

    // Every way completion can fail to happen used to produce no output at
    // all, which is the failure mode this saga exists to remove: the system
    // half-happened and nothing recorded it.
    log.warn('Handover could not be completed and is waiting for a person', {
      handoverId: payload.handoverId,
      state: outcome.from,
      steps: [...done],
    });
  }
}

export const handoverSteps = new HandoverSteps();
