/**
 * Reciprocal rank fusion.
 *
 * Two retrievers that disagree about what a score means cannot have their
 * scores added. A cosine distance is bounded and roughly calibrated; a BM25
 * score is unbounded, corpus-relative, and changes scale with the length of
 * the query. Normalising them onto a shared range means inventing a mapping
 * and then defending it.
 *
 * Rank fusion sidesteps that. Each list contributes `1 / (k + rank)`, so only
 * the order each retriever produced matters, and a document both retrievers
 * rank highly beats one that either ranks first alone. It has no parameters to
 * tune beyond `k`, which only decides how quickly the contribution decays.
 */

export interface RankedList {
  /** Names the retriever, so a fused result can say where it came from. */
  source: string;
  /** Best first. Only the order is used. */
  ids: string[];
  /** Multiplies this list's contribution. 1 treats every retriever equally. */
  weight?: number;
}

export interface FusedHit {
  id: string;
  score: number;
  /** Which retrievers found it, and at what rank, for explaining a result. */
  ranks: Record<string, number>;
}

/**
 * The usual constant.
 *
 * 60 is what the original rank fusion paper settled on, and it is chosen to
 * stop the first position dominating: at k=60 the gap between rank 1 and rank
 * 2 is small, so agreement between retrievers outweighs one retriever's
 * confidence. A much smaller k turns this back into "whatever the first list
 * said".
 */
const DEFAULT_K = 60;

export function reciprocalRankFusion(lists: RankedList[], k = DEFAULT_K): FusedHit[] {
  const fused = new Map<string, FusedHit>();

  lists.forEach((list) => {
    const weight = list.weight ?? 1;

    // Zero means this retriever does not count, which has to mean its ids are
    // absent rather than present with no score: a scored-zero entry still
    // occupies a slot in the caller's top-k.
    if (weight === 0) return;

    list.ids.forEach((id, index) => {
      const rank = index + 1;
      const existing = fused.get(id) ?? { id, score: 0, ranks: {} };

      existing.score += weight * (1 / (k + rank));
      existing.ranks[list.source] = rank;

      fused.set(id, existing);
    });
  });

  return [...fused.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    // A deterministic tie-break, so two runs over the same corpus rank the
    // same way and a shadow comparison measures retrieval rather than noise.
    return a.id.localeCompare(b.id);
  });
}
