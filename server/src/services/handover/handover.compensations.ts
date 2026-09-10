/**
 * Undoing a completed handover (PLAN.md section 10.3).
 *
 * Phase 26 declared what each saga step's compensation means, next to the
 * forward action, and captured the data each one would need before the forward
 * action destroyed it. This is the code those declarations were written for.
 *
 * The rule the whole file exists to honour: **a revert is never a delete.**
 * Three of the five compensations cannot be a delete even in principle. The
 * ledger is append-only, so undoing an award is a second, negative entry. The
 * chain is append-only, so undoing an attestation is a linked revocation
 * record. An email cannot be recalled, so undoing a notification is a
 * correction notice. Only the item statuses and the match record are genuinely
 * restorable, and even those are restored from what was captured rather than
 * guessed at.
 *
 * Each compensation is idempotent and each records itself, so a revert that is
 * retried, or run twice by two admins racing the same escalation, does its
 * work once.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { handoverRepository, HandoverRepository } from '../../repositories/handover.repository.js';
import { createLogger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { sendHandoverCorrectionNotice } from '../email.service.js';
import {
  handoverSagaRepository,
  HandoverSagaRepository,
  STEP_DEFINITIONS,
  type SagaStep,
} from './handover.saga.js';

const log = createLogger('handover:compensate');

/** What one compensation did, for the revert record an admin reads. */
export interface CompensationResult {
  step: SagaStep;
  status: 'compensated' | 'nothing_to_undo' | 'failed';
  detail: string;
}

export interface CompensationContext {
  handoverId: string;
  lostItemId: string;
  foundItemId: string;
  reason: string;
  actorId: string;
}

export class HandoverCompensations {
  constructor(
    private readonly saga: HandoverSagaRepository = handoverSagaRepository,
    private readonly handovers: HandoverRepository = handoverRepository,
    private readonly items = collections.items,
    private readonly matches = collections.matches,
    private readonly matchHistory = collections.matchHistory,
  ) {}

  /**
   * Step 2's compensation: put both items back where they were.
   *
   * From what the forward step captured, not from a guess. "Restore the prior
   * status" needs the prior status, and the item documents stopped carrying it
   * the moment they were set to `Claimed`; phase 26 writes it to the step row
   * before the mutation for exactly this call.
   *
   * An item whose capture is missing is left alone and reported, rather than
   * being set to a plausible-looking `Pending`: putting a claimed item back on
   * the board because nobody recorded where it came from is worse than telling
   * an admin which item needs a decision.
   */
  async restoreItems(context: CompensationContext): Promise<CompensationResult> {
    const captured = await this.saga.capturedUndo(context.handoverId, 'handover.items');
    const prior = captured?.priorStatus as Record<string, unknown> | undefined;

    if (!prior) {
      return {
        step: 'handover.items',
        status: 'nothing_to_undo',
        detail: 'no prior status was captured, so both items were left as they are',
      };
    }

    const restored: string[] = [];
    const skipped: string[] = [];

    for (const itemId of [context.lostItemId, context.foundItemId]) {
      const status = prior[itemId];

      if (typeof status !== 'string') {
        skipped.push(itemId);
        continue;
      }

      const ref = this.items.doc(itemId);
      const snapshot = await ref.get();

      if (!snapshot.exists) {
        skipped.push(itemId);
        continue;
      }

      await ref.set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      restored.push(itemId);
    }

    return {
      step: 'handover.items',
      status: restored.length > 0 ? 'compensated' : 'nothing_to_undo',
      detail: `restored ${restored.length} item(s)${skipped.length > 0 ? `, ${skipped.length} had nothing recorded or no longer exist` : ''}`,
    };
  }

  /**
   * Step 3's compensation: put the match back in the active collection.
   *
   * Restored from the archived copy in `matchHistory`, which is why the
   * forward step archives rather than deletes. The archived row stays where it
   * is: it is the record that this pairing was once completed, and a revert
   * does not make that untrue.
   */
  async restoreMatch(context: CompensationContext): Promise<CompensationResult> {
    const captured = await this.saga.capturedUndo(context.handoverId, 'handover.archive');

    if (captured && captured.hadActiveMatch === false) {
      return {
        step: 'handover.archive',
        status: 'nothing_to_undo',
        detail: 'the match was synthesised and never persisted, so there is none to restore',
      };
    }

    const archived = await this.matchHistory.doc(context.handoverId).get();

    if (!archived.exists) {
      return {
        step: 'handover.archive',
        status: 'nothing_to_undo',
        detail: 'no archived match to restore',
      };
    }

    const data = archived.data() as Record<string, unknown>;

    await this.matches.doc(context.handoverId).set(
      {
        ...data,
        status: 'matched',
        // Cleared, because they describe a completion that has been undone.
        claimedAt: FieldValue.delete(),
        handoverId: FieldValue.delete(),
        revertedAt: FieldValue.serverTimestamp(),
        revertReason: context.reason,
      },
      { merge: true },
    );

    return {
      step: 'handover.archive',
      status: 'compensated',
      detail: 'the match was restored to the active collection',
    };
  }

  /**
   * Step 4's compensation: reversing ledger entries.
   *
   * Never an edit of the originals, and never a delete. A reversal that is
   * indistinguishable from an admin topping somebody up cannot be reconciled,
   * so it carries its own reason and references the same item.
   *
   * An award that was never made is not reversed: `reverseHandoverCredits`
   * checks the original entry exists before posting the negative, so a
   * handover whose credits step was skipped or escalated does not take credits
   * the person never received.
   */
  async reverseCredits(context: CompensationContext): Promise<CompensationResult> {
    const stored = await this.handovers.findCompletedById(context.handoverId);
    const owner = typeof stored?.lostPersonId === 'string' ? stored.lostPersonId : null;
    const finder = typeof stored?.foundPersonId === 'string' ? stored.foundPersonId : null;

    if (!owner && !finder) {
      return {
        step: 'handover.credits',
        status: 'nothing_to_undo',
        detail: 'neither party is on the handover record',
      };
    }

    const { reverseHandoverCredits } = await import('../credits.service.js');
    const note = `Handover ${context.handoverId} reverted: ${context.reason}`;
    const reversed: string[] = [];

    if (owner) {
      const result = await reverseHandoverCredits(
        owner,
        'SUCCESSFUL_MATCH_OWNER',
        context.lostItemId,
        note,
      );

      if (!result.success) throw new Error(`Could not reverse owner credits for ${owner}`);
      if (result.amount !== 0) reversed.push('owner');
    }

    if (finder) {
      const result = await reverseHandoverCredits(
        finder,
        'SUCCESSFUL_MATCH_FINDER',
        context.foundItemId,
        note,
      );

      if (!result.success) throw new Error(`Could not reverse finder credits for ${finder}`);
      if (result.amount !== 0) reversed.push('finder');
    }

    return {
      step: 'handover.credits',
      status: reversed.length > 0 ? 'compensated' : 'nothing_to_undo',
      detail:
        reversed.length > 0
          ? `posted reversing entries for ${reversed.join(' and ')}`
          : 'no awards were found to reverse',
    };
  }

  /**
   * Step 5's compensation: a linked revocation, because the chain is append-only.
   *
   * Nothing on the chain is edited or removed. What is written here is a local
   * revocation record referencing the original transaction hash, so the
   * attestation and its withdrawal are both readable and the order between
   * them is unambiguous.
   *
   * The on-chain half needs a contract method this deployment's contract does
   * not have (`recordHandover` is the only write it exposes), so the record is
   * kept off-chain and marked as such rather than pretending the chain was
   * updated. Writing the revocation on-chain is a contract change and belongs
   * with one.
   */
  async revokeAttestation(context: CompensationContext): Promise<CompensationResult> {
    const stored = await this.handovers.findCompletedById(context.handoverId);
    const txHash = typeof stored?.blockchainTxHash === 'string' ? stored.blockchainTxHash : null;

    // The attestation decides this, not the configuration flag. A deployment
    // that attested a handover and later turned the chain off still has an
    // attestation on a public ledger, and checking the flag first meant the
    // revocation was skipped, recorded as compensated, and never written.
    if (!txHash) {
      return {
        step: 'handover.chain',
        status: 'nothing_to_undo',
        detail: env.blockchain.enabled
          ? 'no attestation was written for this handover'
          : 'blockchain is disabled and no attestation was written',
      };
    }

    await this.handovers.recordChainRevocation(context.handoverId, {
      revokesTxHash: txHash,
      reason: context.reason,
      revokedBy: context.actorId,
      onChain: false,
    });

    return {
      step: 'handover.chain',
      status: 'compensated',
      detail: `revocation record written against ${txHash}, off-chain`,
    };
  }

  /**
   * Step 6's compensation: a correction notice.
   *
   * An email cannot be recalled, so the compensation is to send another one.
   * Both parties are told, separately and with nothing about each other in the
   * message, because they were both told the handover had completed.
   */
  async sendCorrections(context: CompensationContext): Promise<CompensationResult> {
    const completionContext = await this.handovers.loadCompletionContext(
      context.handoverId,
      context.lostItemId,
      context.foundItemId,
    );

    const stored = await this.handovers.findCompletedById(context.handoverId);
    const itemName =
      completionContext.lostItem?.name || completionContext.foundItem?.name || 'your item';

    const recipients = [
      completionContext.lostItem?.reportedByEmail ??
        (stored?.lostPersonDetails as { email?: string } | undefined)?.email,
      completionContext.foundItem?.reportedByEmail ??
        (stored?.foundPersonDetails as { email?: string } | undefined)?.email,
    ].filter((value): value is string => Boolean(value));

    if (recipients.length === 0) {
      return {
        step: 'handover.notify',
        status: 'nothing_to_undo',
        detail: 'no address on either side',
      };
    }

    const sent = await Promise.all(
      recipients.map((recipient) =>
        sendHandoverCorrectionNotice(recipient, itemName, context.reason),
      ),
    );

    if (sent.some((ok: boolean) => !ok)) {
      throw new Error(`Correction notice failed for ${context.handoverId}`);
    }

    return {
      step: 'handover.notify',
      status: 'compensated',
      detail: `correction notice sent to ${recipients.length} recipient(s)`,
    };
  }

  /**
   * One compensation, claimed before it runs and recorded only if it did work.
   *
   * Two rules, both learned the hard way.
   *
   * The claim is transactional. A plain read-then-write let two admins acting
   * on the same escalation within the same second both pass the check and both
   * run the compensation: two correction emails to each party, two item
   * restores, two match writes.
   *
   * Only a real compensation is marked. A step that did nothing because the
   * data it needed was absent is *not* undone, and marking it so made it
   * unretryable forever — the blockchain flag flipped off, a handover record
   * with no party ids, a legacy session with no capture. The revert then
   * reported success while the attestation kept no revocation and the credits
   * stayed awarded, with no path left that would ever fix it.
   */
  async run(
    step: SagaStep,
    context: CompensationContext,
    action: (context: CompensationContext) => Promise<CompensationResult>,
  ): Promise<CompensationResult> {
    if (await this.saga.isCompensated(context.handoverId, step)) {
      return {
        step,
        status: 'nothing_to_undo',
        detail: 'already compensated by an earlier run',
      };
    }

    if (!(await this.saga.claimCompensation(context.handoverId, step))) {
      return {
        step,
        status: 'nothing_to_undo',
        detail: 'another revert is running this compensation',
      };
    }

    let result: CompensationResult;

    try {
      result = await action(context);
    } catch (error) {
      await this.saga.releaseCompensationClaim(context.handoverId, step);

      throw error;
    }

    if (result.status === 'compensated') {
      await this.saga.markCompensated(context.handoverId, step, result.detail);
    } else {
      // Nothing was undone, so nothing is recorded as undone. The claim goes
      // back so a later attempt, once the cause is fixed, can try again.
      await this.saga.releaseCompensationClaim(context.handoverId, step);
    }

    log.info('Compensation applied', {
      handoverId: context.handoverId,
      step,
      status: result.status,
      compensation: STEP_DEFINITIONS[step].compensation,
    });

    return result;
  }
}

export const handoverCompensations = new HandoverCompensations();
