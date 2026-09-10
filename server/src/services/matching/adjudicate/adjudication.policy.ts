/**
 * What deterministic code does with a verdict.
 *
 * Kept apart from the agent on purpose. The agent produces an opinion; this
 * file is the only place that turns an opinion into an outcome, it is pure,
 * and it is where the rules that must hold whatever the model said are
 * written down.
 *
 * Three of those rules:
 *
 * A verdict only applies inside the band. Above it the pair was going to be
 * confirmed anyway and below it discarded, and neither was worth an agent run,
 * so a verdict arriving about a pair outside the band is about a decision that
 * was already made.
 *
 * A verdict only applies when the agent is sure. A confirmation and a
 * rejection are both decisions, and one made at thirty percent confidence is
 * one the deterministic score should have kept. Below the floor the outcome is
 * human review, not the agent's answer.
 *
 * A verdict may never confirm a pair the deterministic pipeline refused on
 * evidence. The score, the semantic requirement and the minimum applicable
 * weight are guards against matching two reports on almost nothing, and
 * section 8.8 is explicit that they stand whatever the model says.
 */

import type { AdjudicationTrace } from './adjudication.types.js';

/**
 * What the pipeline does with the pair.
 *
 * `unchanged` is not a failure. It is what a shadow run always produces, and
 * what an `on` run produces when the verdict is not decisive enough to move
 * anything.
 */
export type AdjudicationOutcome = 'confirm' | 'discard' | 'human_review' | 'unchanged';

export interface VerdictContext {
  /** Whether the deterministic pipeline had this pair as a match. */
  wasMatch: boolean;
  /**
   * Whether the pair cleared `MATCH_CONFIG.THRESHOLD`.
   *
   * Separate from `eligible` because it is a different kind of refusal. A pair
   * below the threshold is one the deterministic scorer was not convinced by,
   * and an agent may argue for it — but the argument goes to a person, not to
   * the automatic path, because confirming here starts a handover that emails
   * two strangers a collection code and writes a blockchain record.
   */
  aboveThreshold: boolean;
  /**
   * Whether the pair could be a match at all on the deterministic evidence:
   * the semantic component ran and enough of the scoring model applied.
   *
   * A pair that fails this may never be confirmed by a verdict. It may still
   * be sent to human review, because a person can look at the two reports.
   */
  eligible: boolean;
  minConfidence: number;
  /** `shadow` records and changes nothing, which is the default. */
  mode: 'shadow' | 'on';
}

export function applyVerdict(
  trace: AdjudicationTrace,
  context: VerdictContext,
): AdjudicationOutcome {
  if (context.mode !== 'on') return 'unchanged';

  const { decision, confidence } = trace.verdict;

  // Not sure enough to move anything on its own, but sure enough that the
  // deterministic answer should not be acted on unseen either.
  if (confidence < context.minConfidence) return context.wasMatch ? 'human_review' : 'unchanged';

  if (decision === 'no_match') return context.wasMatch ? 'discard' : 'unchanged';

  if (decision === 'match') {
    // Evidence guards are absolute: a pair scored on colour and time alone is
    // one nothing checked was the same object, whatever the agent says.
    if (!context.eligible) return context.wasMatch ? 'human_review' : 'unchanged';

    // Below the deterministic threshold the agent may propose, not decide.
    return context.aboveThreshold ? 'confirm' : 'human_review';
  }

  // needs_human_review. A pair the pipeline was not going to match anyway does
  // not become a review item because the agent could not decide about it.
  return context.wasMatch ? 'human_review' : 'unchanged';
}

/**
 * Whether the outcome takes the pair out of the automatic path.
 *
 * `human_review` keeps the match record, so an admin sees the pair and the
 * agent's reasoning, and stops the automatic handover, which is the step that
 * emails two people and cannot be taken back.
 *
 * `discard` stops it too, and that is less obvious. Removing the winner
 * promotes the runner-up, and the runner-up is a pair no agent looked at and
 * which scored lower than the one just rejected. Handing it straight to an
 * automatic handover would turn "the agent rejected the top pair" into "act on
 * the next one unexamined", which is worse than not having run the agent.
 */
export function blocksAutoHandover(outcome: AdjudicationOutcome): boolean {
  return outcome === 'human_review' || outcome === 'discard';
}
