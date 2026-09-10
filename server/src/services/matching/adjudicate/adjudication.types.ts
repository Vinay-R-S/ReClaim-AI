/**
 * Stage 3 of the pipeline in section 8.2: adjudicate.
 *
 * The stage before it scores twenty candidates against each other in one call.
 * That is a comparison, and a comparison of the text two people happened to
 * write. It cannot go and check whether the two reports are consistent about
 * anything else: whether the photographs look like the same object, whether
 * the places are half a kilometre or fourteen apart, whether the person
 * claiming the item has filed six claims this week.
 *
 * So the last stage is an agent with tools, run on one pair, and only when the
 * score is inside a band where the deterministic answer is genuinely unsure.
 * Everything about it is bounded: tool calls, wall clock, and what it is
 * allowed to do with the answer, which is nothing. It returns a recommendation
 * and deterministic code decides.
 */

import type { AdjudicationDecision, AdjudicationStop, Item } from '../../../types/index.js';
import type { MatchSubject } from '../matching.types.js';

export type { AdjudicationDecision, AdjudicationStop };

/**
 * `AdjudicationDecision` and `AdjudicationStop` come from `shared/domain.d.ts`
 * and are re-exported above rather than restated here.
 *
 * They are half of a document the browser reads, and this file is the only
 * place that produces one. Declaring them twice is how the two packages drifted
 * before (defect ARCH-08): a fifth stop reason added here would ship, be
 * persisted, and fall through the admin screen's lookup without one line
 * failing to compile.
 *
 * `needs_human_review` is a real outcome and not a failure: an agent that has
 * spent its budget and found evidence both ways has learned something, and
 * saying so is more useful than being forced into a coin flip.
 */

export interface AdjudicationVerdict {
  decision: AdjudicationDecision;
  /** 0-100, the agent's own. Validated as an integer, never parsed from prose. */
  confidence: number;
  /** Facts the agent says support the decision. Model-generated, so untrusted. */
  evidence: string[];
  /** Facts it says argue against it. An empty list on a real pair is suspicious. */
  contradictions: string[];
}

/** One tool call, as it happened. */
export interface AdjudicationStep {
  tool: string;
  /** Arguments as the agent gave them, after validation. */
  args: Record<string, unknown>;
  /**
   * What the tool answered, as the string the agent saw.
   *
   * Truncated on the way in here rather than on the way out: this is persisted
   * on the match record and read by an admin, and a tool that returned a page
   * of text would put a page of text into every match document.
   */
  result: string;
  ms: number;
  /** True when the tool refused, which the agent is told and may recover from. */
  failed?: boolean;
}

/**
 * The full trace, persisted on the match record.
 *
 * The point of persisting it is section 8.6's last bullet: an admin looking at
 * a match a week later can see which tools ran, what they returned, and what
 * the agent concluded from them. A verdict with no trace is an opinion.
 */
export interface AdjudicationTrace {
  verdict: AdjudicationVerdict;
  /** Which pair was adjudicated, so a trace cannot be read against the wrong one. */
  lostItemId: string;
  foundItemId: string;
  /** The pipeline score that put the pair in the band. */
  pipelineScore: number;
  steps: AdjudicationStep[];
  toolCalls: number;
  /** Model turns, which is tool calls plus the one that produced the verdict. */
  modelCalls: number;
  stoppedBy: AdjudicationStop;
  promptVersion: string;
  /** Every model that answered, comma separated, for the same reason rerank does it. */
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  /** `on` means this verdict was allowed to change the outcome. */
  mode: 'shadow' | 'on';
}

export interface AdjudicationRequest {
  subject: MatchSubject;
  candidate: Item;
  /** The normalised pipeline score for the pair, 0-100. */
  pipelineScore: number;
  /** The subject's own type, so the tools know which side is which. */
  subjectType: 'Lost' | 'Found';
}

export interface Adjudicator {
  /**
   * Reach a verdict on one pair.
   *
   * Returns null when no verdict was reached at all: no provider, a run that
   * died on its first step, a reply that never validated. Null and
   * `needs_human_review` are different facts. One means the agent could not be
   * asked, the other means it was asked and could not tell.
   */
  adjudicate(request: AdjudicationRequest): Promise<AdjudicationTrace | null>;
}
