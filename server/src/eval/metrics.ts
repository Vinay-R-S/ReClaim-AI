/**
 * Retrieval and ranking metrics (section 8.7).
 *
 * Plain functions over a ranked list of ids and a set of relevant ids, so they
 * can be tested against worked examples rather than against the pipeline. Every
 * one of them is defined for the empty and the degenerate case, because those
 * are what a small labelled set actually produces: a query with no relevant
 * item, a run that retrieved nothing.
 */

export interface RankedRun {
  /** The ids the system returned, best first. */
  ranked: string[];
  /** The ids that should have been returned. */
  relevant: Set<string>;
}

/**
 * Share of the relevant items that appear in the top k.
 *
 * The metric for retrieval: a candidate the reranker never sees cannot be
 * matched, however good the reranker is.
 */
/**
 * The top k, with duplicates removed.
 *
 * A repeated id would otherwise be counted repeatedly, so a ranking of
 * `[a, a, a]` against a single relevant `a` scores a recall of 3. That is not
 * an error anybody would notice, because the failure mode is a score going
 * *up*: a future bug in fusion or in the tail would read as an improvement.
 */
function head(run: RankedRun, k: number): string[] {
  return [...new Set(run.ranked)].slice(0, k);
}

export function recallAtK(run: RankedRun, k: number): number {
  if (run.relevant.size === 0) return 1;

  const found = head(run, k).filter((id) => run.relevant.has(id)).length;

  return found / run.relevant.size;
}

export function precisionAtK(run: RankedRun, k: number): number {
  const top = head(run, k);

  if (top.length === 0) return 0;

  return top.filter((id) => run.relevant.has(id)).length / top.length;
}

/**
 * Reciprocal of the rank of the first relevant item.
 *
 * Sensitive to exactly the thing that matters here: not whether the right
 * candidate was retrieved, but how far down it was.
 */
export function reciprocalRank(run: RankedRun): number {
  const index = [...new Set(run.ranked)].findIndex((id) => run.relevant.has(id));

  return index === -1 ? 0 : 1 / (index + 1);
}

function dcg(ranked: string[], relevant: Set<string>, k: number): number {
  return [...new Set(ranked)].slice(0, k).reduce((total, id, index) => {
    if (!relevant.has(id)) return total;

    // Binary relevance, so the gain is 1 and the discount is positional.
    return total + 1 / Math.log2(index + 2);
  }, 0);
}

/**
 * Normalised discounted cumulative gain.
 *
 * Rewards putting the relevant items high rather than merely including them,
 * which is what separates a reranker from a retriever.
 */
export function ndcgAtK(run: RankedRun, k: number): number {
  if (run.relevant.size === 0) return 1;

  const ideal = dcg([...run.relevant].slice(0, k), run.relevant, k);

  if (ideal === 0) return 1;

  return dcg(run.ranked, run.relevant, k) / ideal;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;

  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);

  return sorted[Math.max(0, index)];
}

export interface BinaryOutcome {
  predicted: boolean;
  actual: boolean;
}

/**
 * End-to-end precision and recall at the auto-confirm threshold.
 *
 * Reported together and never separately: a matcher that confirms nothing has
 * perfect precision, and one that confirms everything has perfect recall.
 */
/**
 * End-to-end precision and recall at the auto-confirm threshold.
 *
 * Reported together and never separately: a matcher that confirms nothing has
 * perfect precision, and one that confirms everything has perfect recall.
 *
 * `null` rather than 1 when a denominator is empty. A reranker that answered
 * nothing produces no outcomes at all, and reporting that as
 * "precision 1.000, recall 1.000" is the single most flattering thing this
 * file could do to a component that did not run.
 */
export function precisionRecall(outcomes: BinaryOutcome[]): {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
} {
  const truePositives = outcomes.filter((o) => o.predicted && o.actual).length;
  const falsePositives = outcomes.filter((o) => o.predicted && !o.actual).length;
  const falseNegatives = outcomes.filter((o) => !o.predicted && o.actual).length;

  const precision =
    truePositives + falsePositives === 0 ? null : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0 ? null : truePositives / (truePositives + falseNegatives);

  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1, truePositives, falsePositives, falseNegatives };
}
