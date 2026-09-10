/**
 * `revertHandover` and the dispute flow (PLAN.md section 10.3).
 *
 * Two entry points, and the difference between them is who is allowed to be
 * sure. A **dispute** is either party saying something is wrong: it freezes
 * the handover, routes it to an admin, and decides nothing. A **revert** is an
 * admin deciding, and it runs the compensations.
 *
 * Three properties the plan asks for, and where each lives:
 *
 * *Runs backwards.* The compensations run step 6 to step 1 — the notice, then
 * the chain, then the credits, then the match, then the items, then the state
 * transition. Backwards because the forward order is the order of increasing
 * commitment: the items are what the physical world is being told about, so
 * they are the last thing undone and the first thing done.
 *
 * *Idempotent.* Each compensation records itself, and the final transition is
 * refused by the table on a second run because `reverted` has no `revert` edge
 * into it. Two admins racing the same escalation produce one revert.
 *
 * *Audited.* Every compensation's outcome is written to the handover event's
 * metadata and to the audit trail, with the admin and their typed reason. A
 * revert with no reason is refused at the schema.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { handoverRepository, HandoverRepository } from '../../repositories/handover.repository.js';
import { createLogger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import type { DisputeOutcome, DisputeReason } from '../../types/index.js';
import {
  handoverCompensations,
  HandoverCompensations,
  type CompensationContext,
  type CompensationResult,
} from './handover.compensations.js';
import { handoverMachine, HandoverMachine, stateOf } from './handover.machine.js';
import { handoverSagaRepository, HandoverSagaRepository } from './handover.saga.js';
import type { HandoverState } from './handover.states.js';

const log = createLogger('handover:revert');

export interface RevertOutcome {
  success: boolean;
  message: string;
  /** What each compensation did, in the order they ran. */
  compensations?: CompensationResult[];
}

export interface DisputeOutcomeResult {
  success: boolean;
  message: string;
}

/** Who is raising a dispute, resolved from the handover rather than the body. */
export type DisputeParty = 'owner' | 'finder' | 'admin';

export class HandoverRevertService {
  constructor(
    private readonly compensations: HandoverCompensations = handoverCompensations,
    private readonly machine: HandoverMachine = handoverMachine,
    private readonly handovers: HandoverRepository = handoverRepository,
    private readonly disputes = collections.disputes,
    private readonly saga: HandoverSagaRepository = handoverSagaRepository,
  ) {}

  /**
   * Undo a completed handover.
   *
   * Admin only, and the caller checks that; what this owns is that the undoing
   * is complete, ordered and recorded. A compensation that throws stops the
   * revert where it is rather than carrying on: the remaining steps are the
   * ones closer to the physical world, and running them against a half-undone
   * handover is worse than stopping and telling somebody.
   */
  async revert(handoverId: string, reason: string, actorId: string): Promise<RevertOutcome> {
    const ref = await this.handovers.resolveCodeRefById(handoverId);
    const snapshot = await ref.get();

    if (!snapshot.exists) return { success: false, message: 'Handover session not found' };

    const data = snapshot.data() as Record<string, unknown>;
    const state = stateOf(data);

    if (state === 'reverted') {
      return { success: true, message: 'This handover has already been reverted' };
    }

    if (state !== 'completed' && state !== 'disputed') {
      return {
        success: false,
        message: `Only a completed or disputed handover can be reverted; this one is ${state.replace(/_/g, ' ')}`,
      };
    }

    const lostItemId = typeof data.lostItemId === 'string' ? data.lostItemId : null;
    const foundItemId = typeof data.foundItemId === 'string' ? data.foundItemId : null;

    // A session document with no item ids is one this code cannot compensate:
    // restoring an item needs to know which item. Refusing is the honest
    // answer, because the alternative is a revert that silently skips the two
    // steps that touch the physical world and reports success.
    if (!lostItemId || !foundItemId) {
      return {
        success: false,
        message:
          'This handover does not record which items it was for, so it cannot be reverted automatically',
      };
    }

    const context: CompensationContext = {
      handoverId,
      lostItemId,
      foundItemId,
      reason,
      actorId,
    };

    // The recoverable compensations first, and the notice last of all — after
    // the state transition below, not before it.
    //
    // Section 10.3 numbers the forward steps and says the revert runs 6 back
    // to 1, which puts the email first. That is the one ordering this must not
    // use. The email is the only step that cannot be taken back, and a revert
    // that fails at, say, the credit reversal would already have told two
    // members of the public that their credits were reversed and their reports
    // restored — while the items are still claimed and the credits still
    // awarded. Telling somebody something false is worse than telling them
    // late, so the notice waits until the revert is real.
    const plan = [
      { step: 'handover.chain' as const, run: () => this.compensations.revokeAttestation(context) },
      { step: 'handover.credits' as const, run: () => this.compensations.reverseCredits(context) },
      { step: 'handover.archive' as const, run: () => this.compensations.restoreMatch(context) },
      { step: 'handover.items' as const, run: () => this.compensations.restoreItems(context) },
    ];

    const results: CompensationResult[] = [];

    for (const { step, run } of plan) {
      try {
        results.push(await this.compensations.run(step, context, run));
      } catch (error) {
        log.error('Compensation failed, stopping the revert', { handoverId, step, error });

        return {
          success: false,
          message: `The revert stopped at ${step}. What ran before it has been recorded, and neither party has been told; fix the cause and run the revert again.`,
          compensations: results,
        };
      }
    }

    const outcome = await this.machine.apply(ref, {
      matchId: handoverId,
      transition: 'revert',
      actor: actorId,
      actorRole: 'admin',
      reason,
      metadata: { compensations: results },
      patch: { revertedAt: FieldValue.serverTimestamp(), revertReason: reason },
    });

    if (!outcome.ok) {
      return {
        success: false,
        message: `The compensations ran but the handover could not be moved out of ${outcome.from}`,
        compensations: results,
      };
    }

    // The forward step records are cleared now that the handover really is
    // reverted. Without this a re-issued and re-verified handover finds every
    // step still marked `done`, skips all five, and is moved back to
    // `completed` with nothing having happened.
    await this.saga.resetForRevert(handoverId);

    // Now the notice, because now it is true.
    try {
      results.push(
        await this.compensations.run('handover.notify', context, () =>
          this.compensations.sendCorrections(context),
        ),
      );
    } catch (error) {
      // The revert itself stands. An undelivered notice is a thing to chase,
      // not a reason to leave the handover recorded as completed.
      log.error('Handover reverted but the correction notice failed', { handoverId, error });

      results.push({
        step: 'handover.notify',
        status: 'failed',
        detail: 'the correction notice could not be sent; both parties still need telling',
      });
    }

    // A handover completed before the saga started recording steps has nothing
    // captured to compensate from, so every one of the four recoverable steps
    // answers `nothing_to_undo` and the revert reports plain success. The
    // handover is then marked reverted while the items are still claimed, the
    // credits still awarded and the attestation still standing. That needs a
    // person, so it is escalated rather than logged.
    const undone = results.filter((entry) => entry.status === 'compensated');
    const nothingWasUndone = undone.length === 0;

    if (nothingWasUndone) {
      await this.saga.escalate(
        handoverId,
        'handover.items',
        new Error(
          'reverted, but no compensation found anything to undo: this handover predates the step log, so the items, credits and attestation need checking by hand',
        ),
      );
    }

    await this.handovers.writeAudit({
      action: 'handover_reverted',
      matchId: handoverId,
      actorId,
      details: { reason, compensations: results, nothingWasUndone },
    });

    // The hold exists to stop contested credits being spent. They have now
    // been reversed, so there is nothing left to hold.
    await this.handovers.unfreezeHandoverCredits(handoverId);

    // A dispute that prompted this is settled by it.
    await this.closeDispute(handoverId, actorId, 'upheld', reason);

    log.warn('Handover reverted', { handoverId, actorId, steps: results.length });

    return {
      success: true,
      message: nothingWasUndone
        ? 'Handover reverted, but nothing was undone: it predates the step log, so the items, credits and attestation need checking by hand. An escalation has been raised.'
        : 'Handover reverted',
      compensations: results,
    };
  }

  /**
   * Either party says something is wrong.
   *
   * Decides nothing. It moves the handover to `disputed`, which stops it being
   * treated as settled, and puts it in front of an admin. The window is
   * configurable and measured from the handover record, because a dispute
   * raised a year later is a support conversation rather than a state
   * transition.
   */
  async raiseDispute(
    handoverId: string,
    actorId: string,
    party: DisputeParty,
    reason: DisputeReason,
    note: string | null,
  ): Promise<DisputeOutcomeResult> {
    const ref = await this.handovers.resolveCodeRefById(handoverId);
    const snapshot = await ref.get();

    if (!snapshot.exists) return { success: false, message: 'Handover session not found' };

    const state = stateOf(snapshot.data() as Record<string, unknown>);

    if (state === 'disputed') {
      // Joined rather than opened again, so an admin resolves one handover
      // once instead of racing themselves across two rows. Joining appends;
      // it does not replace. Merging the second person's identity and reason
      // over the first's let the accused party quietly rewrite the complaint
      // the admin was about to read.
      await this.joinDispute(handoverId, actorId, party, reason, note);

      // Both of these are idempotent, and both run here as well as on the
      // first dispute: the transition can commit and the process die before
      // them, and a retry would otherwise leave the credits unheld and nothing
      // in the audit trail.
      await this.handovers.freezeHandoverCredits(handoverId, actorId, reason);
      await this.handovers.writeAudit({
        action: 'handover_disputed',
        matchId: handoverId,
        actorId,
        details: { reason, note, party, joined: true },
      });

      return { success: true, message: 'Your dispute has been added to the open review' };
    }

    if (state !== 'completed') {
      return {
        success: false,
        message: 'Only a completed handover can be disputed',
      };
    }

    const withinWindow = await this.withinDisputeWindow(handoverId);

    if (!withinWindow && party !== 'admin') {
      return {
        success: false,
        message: `Disputes close ${env.handover.disputeWindowDays} days after a handover. Contact support instead.`,
      };
    }

    const outcome = await this.machine.apply(ref, {
      matchId: handoverId,
      transition: 'dispute',
      actor: actorId,
      actorRole: party,
      reason,
      metadata: { note },
      patch: { disputedAt: FieldValue.serverTimestamp() },
    });

    if (!outcome.ok) {
      return { success: false, message: `This handover is ${outcome.from} and cannot be disputed` };
    }

    await this.recordDispute(handoverId, actorId, party, reason, note);

    // The credits are frozen rather than reversed. Reversing them would decide
    // the dispute in advance, and the whole point of `disputed` is that nobody
    // has decided yet.
    await this.handovers.freezeHandoverCredits(handoverId, actorId, reason);

    await this.handovers.writeAudit({
      action: 'handover_disputed',
      matchId: handoverId,
      actorId,
      details: { reason, note, party },
    });

    log.warn('Handover disputed', { handoverId, party, reason });

    return { success: true, message: 'Your dispute has been raised and an admin will review it' };
  }

  /**
   * An admin decides.
   *
   * Upheld runs the revert. Rejected puts the handover back to `completed`,
   * which the table allows precisely for this: a dispute that was not upheld
   * does not leave the handover in limbo.
   */
  async resolveDispute(
    handoverId: string,
    actorId: string,
    outcome: DisputeOutcome,
    note: string,
  ): Promise<RevertOutcome> {
    const open = await this.hasOpenDispute(handoverId);

    // Checked for both outcomes. Upholding delegates to `revert`, which
    // accepts a `completed` handover as well as a disputed one, so without
    // this a second admin acting on a stale queue could revert a dispute the
    // first had already rejected — reversing credits and emailing both parties
    // about a decision that had been made the other way.
    if (!open) {
      return { success: false, message: 'This handover has no open dispute' };
    }

    if (outcome === 'upheld') return this.revert(handoverId, note, actorId);

    const ref = await this.handovers.resolveCodeRefById(handoverId);
    const snapshot = await ref.get();

    if (!snapshot.exists) return { success: false, message: 'Handover session not found' };

    const state = stateOf(snapshot.data() as Record<string, unknown>);

    // `completed` with an open dispute row is a rejection that committed its
    // transition and then died before closing the row. Finishing it is the
    // recovery; refusing would leave the row in the queue forever with the
    // credits held, and the only escape would be to uphold a dispute the admin
    // had decided against.
    if (state !== 'disputed' && state !== 'completed') {
      return { success: false, message: `This handover is ${state} and has no open dispute` };
    }

    if (state === 'disputed') {
      const applied = await this.machine.apply(ref, {
        matchId: handoverId,
        transition: 'complete',
        actor: actorId,
        actorRole: 'admin',
        reason: `dispute rejected: ${note}`,
        expect: ['disputed'],
      });

      if (!applied.ok) {
        return { success: false, message: 'The handover could not be returned to completed' };
      }
    }

    await this.handovers.unfreezeHandoverCredits(handoverId);
    await this.closeDispute(handoverId, actorId, 'rejected', note);

    await this.handovers.writeAudit({
      action: 'handover_dispute_rejected',
      matchId: handoverId,
      actorId,
      details: { note },
    });

    return { success: true, message: 'Dispute rejected and the handover restored' };
  }

  /** Whether a dispute row is open for this handover. */
  private async hasOpenDispute(handoverId: string): Promise<boolean> {
    const snapshot = await this.disputes.doc(handoverId).get();

    return snapshot.exists && (snapshot.data() as { status?: string }).status === 'open';
  }

  /** The open disputes, for the admin queue. */
  async listOpenDisputes(limit = 100) {
    const snapshot = await this.disputes.where('status', '==', 'open').limit(limit).get();

    return snapshot.docs.map((doc) => ({ ...doc.data(), handoverId: doc.id }));
  }

  /**
   * Whether the handover is young enough to dispute.
   *
   * Measured from the handover record rather than the session document,
   * because the session is re-written by every transition and the handover
   * record is written once.
   *
   * A handover with no record and no timestamp is treated as disputable. That
   * is the case a pre-phase-26 session lands in, and the safe direction: the
   * cost of allowing a late dispute is an admin reading it, and the cost of
   * refusing a valid one is somebody with a real complaint being told no.
   */
  private async withinDisputeWindow(handoverId: string): Promise<boolean> {
    const stored = await this.handovers.findCompletedById(handoverId);
    const handoverTime = stored?.handoverTime as { toDate?: () => Date } | undefined;
    const at = handoverTime?.toDate?.();

    if (!at) return true;

    const ageDays = (Date.now() - at.getTime()) / (24 * 60 * 60 * 1000);

    return ageDays <= env.handover.disputeWindowDays;
  }

  /**
   * Open a dispute row.
   *
   * Every field a previous cycle may have left behind is cleared, not merged
   * over. A rejected dispute writes `outcome`, `resolvedBy`, `resolutionNote`
   * and `resolvedAt`; re-raising without clearing them produced a row that was
   * simultaneously open and resolved, which is a shape the admin queue and the
   * published contract both describe as a decision already made.
   */
  private async recordDispute(
    handoverId: string,
    actorId: string,
    party: DisputeParty,
    reason: DisputeReason,
    note: string | null,
  ): Promise<void> {
    await this.disputes.doc(handoverId).set(
      {
        handoverId,
        raisedBy: actorId,
        raisedByRole: party,
        reason,
        note,
        status: 'open',
        raisedAt: FieldValue.serverTimestamp(),
        joinedBy: [],
        outcome: FieldValue.delete(),
        resolvedBy: FieldValue.delete(),
        resolutionNote: FieldValue.delete(),
        resolvedAt: FieldValue.delete(),
      },
      { merge: true },
    );
  }

  /**
   * A second party adding their side to an open dispute.
   *
   * Appended. The row keeps the person who raised it and the reason they gave,
   * because that is the complaint the admin is adjudicating; the second
   * account is added beside it rather than over it.
   */
  private async joinDispute(
    handoverId: string,
    actorId: string,
    party: DisputeParty,
    reason: DisputeReason,
    note: string | null,
  ): Promise<void> {
    await this.disputes.doc(handoverId).set(
      {
        joinedBy: FieldValue.arrayUnion({
          actorId,
          party,
          reason,
          note,
          at: new Date().toISOString(),
        }),
      },
      { merge: true },
    );
  }

  private async closeDispute(
    handoverId: string,
    actorId: string,
    outcome: DisputeOutcome,
    note: string,
  ): Promise<void> {
    const ref = this.disputes.doc(handoverId);
    const snapshot = await ref.get();

    if (!snapshot.exists) return;

    await ref.set(
      {
        status: 'resolved',
        outcome,
        resolvedBy: actorId,
        resolutionNote: note,
        resolvedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  /** The state a handover is in, for a caller that only wants to check. */
  async stateOf(handoverId: string): Promise<HandoverState | null> {
    const ref = await this.handovers.resolveCodeRefById(handoverId);
    const snapshot = await ref.get();

    if (!snapshot.exists) return null;

    return stateOf(snapshot.data() as Record<string, unknown>);
  }
}

export const handoverRevertService = new HandoverRevertService();
