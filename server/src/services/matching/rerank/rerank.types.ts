/**
 * Stage 2 of the pipeline in section 8.2: rerank.
 *
 * Retrieval supplies recall, reranking supplies precision. The difference from
 * the stage it replaces is arithmetic: the old scorer called a model once per
 * candidate, so twenty-five candidates was twenty-five calls, twenty-five
 * timeouts and twenty-five chances for one of them to fail. A reranker sees
 * every candidate in one call and scores them against each other, which is
 * both cheaper and better — a model comparing twenty descriptions can tell
 * which is the best of them, and a model shown one pair at a time cannot.
 */

import type { Item } from '../../../types/index.js';
import type { MatchSubject } from '../matching.types.js';

/** What the model is asked to decide about one pair. */
export type RerankVerdict = 'same' | 'likely' | 'unlikely' | 'different';

export interface RerankedCandidate {
  /** The candidate's item id, as it was labelled in the prompt. */
  id: string;
  /** 0-100. Validated as an integer in range, never parsed out of prose. */
  score: number;
  verdict: RerankVerdict;
  /**
   * The model's stated reason.
   *
   * Captured and, deliberately, not used: nothing reads it, logs it or stores
   * it. It is model-generated text derived from attacker-controlled input, so
   * the day it reaches an admin screen it needs escaping at the render site
   * and a length the schema enforces on both sides. Until then it costs
   * nothing and the audit trail it was meant for is the adjudication phase.
   */
  reason?: string;
}

export interface RerankResult {
  scores: Map<string, RerankedCandidate>;
  /** Which model produced this, so a stored score stays explainable. */
  model: string;
  /** How many candidates went in, for the log. */
  requested: number;
  ms: number;
}

export interface Reranker {
  /**
   * Score every candidate against the subject in one call.
   *
   * Returns null when the model could not be reached or its answer did not
   * survive validation. Null and "everything scored zero" are different facts
   * and the caller must be able to tell them apart: one means the pairs are
   * unrelated, the other means nothing was decided.
   */
  rerank(subject: MatchSubject, candidates: Item[]): Promise<RerankResult | null>;
}
