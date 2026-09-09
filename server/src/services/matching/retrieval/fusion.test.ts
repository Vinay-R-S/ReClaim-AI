/**
 * Rank fusion.
 *
 * The property that makes it worth using instead of adding scores: agreement
 * between two retrievers beats one retriever's confidence, and neither
 * retriever's score scale enters into it at all.
 */

import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './fusion.js';

describe('reciprocalRankFusion', () => {
  it('ranks a document both retrievers found above one either found first', () => {
    const fused = reciprocalRankFusion([
      { source: 'dense', ids: ['a', 'shared'] },
      { source: 'lexical', ids: ['b', 'shared'] },
    ]);

    expect(fused[0].id).toBe('shared');
  });

  it('records where each hit came from and at what rank', () => {
    const [top] = reciprocalRankFusion([
      { source: 'dense', ids: ['x'] },
      { source: 'lexical', ids: ['y', 'x'] },
    ]);

    expect(top.ranks).toEqual({ dense: 1, lexical: 2 });
  });

  it('keeps a single list in its own order', () => {
    const fused = reciprocalRankFusion([{ source: 'dense', ids: ['a', 'b', 'c'] }]);

    expect(fused.map((hit) => hit.id)).toEqual(['a', 'b', 'c']);
  });

  it('is unaffected by the scale of either retriever, because it never sees one', () => {
    const one = reciprocalRankFusion([
      { source: 'dense', ids: ['a', 'b'] },
      { source: 'lexical', ids: ['b', 'a'] },
    ]);

    // Perfectly disagreeing lists: both documents have the same fused score,
    // and the tie-break is deterministic rather than insertion order.
    expect(one.map((hit) => hit.id)).toEqual(['a', 'b']);
    expect(one[0].score).toBeCloseTo(one[1].score);
  });

  it('lets a weighted list count for more', () => {
    const fused = reciprocalRankFusion([
      { source: 'dense', ids: ['a'], weight: 3 },
      { source: 'lexical', ids: ['b'] },
    ]);

    expect(fused[0].id).toBe('a');
  });

  it('returns nothing for no lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it('ignores an empty list rather than counting it', () => {
    const fused = reciprocalRankFusion([
      { source: 'dense', ids: [] },
      { source: 'lexical', ids: ['only'] },
    ]);

    expect(fused.map((hit) => hit.id)).toEqual(['only']);
  });

  /**
   * At the default k of 60 the gap between rank 1 and rank 2 is deliberately
   * small: that is what makes agreement outweigh one retriever's confidence.
   * A much smaller k turns this back into "whatever the first list said".
   */
  it('keeps the gap between adjacent ranks small at the default k', () => {
    const fused = reciprocalRankFusion([{ source: 'dense', ids: ['a', 'b'] }]);
    const gap = fused[0].score - fused[1].score;

    expect(gap).toBeLessThan(fused[0].score * 0.05);
  });
});
