/**
 * The regression gate (section 8.7).
 *
 * These are not tests of a function's behaviour; they are a floor under the
 * matcher's quality that CI fails the build for crossing.
 *
 * Deliberately no model call. The retrieval half is deterministic, so it runs
 * the same on any machine; the dense half needs weights a runner would have to
 * download and the rerank half needs a provider key. A gate that only runs
 * where a download succeeded or a secret exists is a gate nobody trusts. What
 * this pins is the floor: what the system achieves with no vectors at all,
 * which is also what it falls back to whenever the index is missing or the
 * corpus is not embedded.
 *
 * When one fails: look at the per-case reciprocal ranks in `npm run eval`
 * before touching the number. Lowering a threshold to make a build pass is how
 * a quality gate becomes a comment.
 */

import { describe, expect, it } from 'vitest';
import { EVAL_CASES, caseCounts, datasetHash, type EvalCase } from './dataset.js';
import { retrieveLexical, runEval } from './runner.js';
import { mean, ndcgAtK, precisionAtK, recallAtK, reciprocalRank } from './metrics.js';

/**
 * The floor, as measured on this dataset by the code that exists.
 *
 * `recall@3` and `recall@5` are absent on purpose. Every corpus here is
 * smaller than five and the retriever appends whatever it did not rank, so
 * both are 1.000 for any ranking whatsoever — including an empty one. They
 * were in this list, and they were two assertions that could never fail.
 * `recall@1` is the one that separates the retrievers.
 */
const FLOOR = {
  'recall@1': 0.6,
  'precision@1': 0.5,
  'ndcg@5': 0.82,
  mrr: 0.65,
};

/**
 * What the same set measures with the dense half as well, for the record.
 *
 * Not asserted: it needs the model weights. Reproduce with
 * `npm run eval -- --dense`. The gap is the justification for phases 22 and 23
 * existing, measured rather than argued:
 *
 *   metric        lexical   hybrid
 *   recall@1      0.667     0.889
 *   precision@1   0.556     0.778
 *   ndcg@5        0.848     0.944
 *   mrr           0.685     0.815
 *
 * Two cases account for the gap, `phone-paraphrase` and `keys-keyring`, where
 * the true match shares almost no wording with the query and only a vector can
 * rank it. One case, `wallet-colour`, still defeats both retrievers and is
 * what the reranker has to earn its place on.
 *
 * These numbers moved once already. Preserving hyphenated identifiers in the
 * tokeniser and weighting them took lexical recall@1 from 0.556 to 0.667, and
 * promoting an exact identifier match ahead of the fused order took hybrid
 * from 0.778 to 0.889. Both were found by measuring, not by guessing: raising
 * the dense retriever's fusion weight, which sounds like it should help, made
 * it worse by burying the serial-number case.
 */

/**
 * A one-line heuristic that does no retrieval at all.
 *
 * The first version of this dataset was cleared by exactly this: ranking each
 * corpus by whether the colour string matched, with no BM25 and no vectors,
 * passed every floor and beat the shipped retriever on two of three metrics.
 * The set was measuring colour agreement and calling it retrieval.
 *
 * It is kept as an assertion rather than deleted, because the property a
 * labelled set needs is not "the system scores well on it" but "a system that
 * does nothing scores badly on it".
 */
function colourOnly(entry: EvalCase): string[] {
  return [...entry.corpus]
    .sort((a, b) => Number(b.color === entry.query.color) - Number(a.color === entry.query.color))
    .map((item) => item.id);
}

function scoreWith(ranker: (entry: EvalCase) => string[]) {
  const runs = EVAL_CASES.map((entry) => ({
    ranked: ranker(entry),
    relevant: new Set(entry.relevant),
  }));

  return {
    'recall@1': mean(runs.map((run) => recallAtK(run, 1))),
    'precision@1': mean(runs.map((run) => precisionAtK(run, 1))),
    'ndcg@5': mean(runs.map((run) => ndcgAtK(run, 5))),
    mrr: mean(runs.map(reciprocalRank)),
  };
}

describe('the labelled set', () => {
  it('has hard negatives, not just easy ones', () => {
    const withHardNegative = EVAL_CASES.filter((entry) => {
      const distractors = entry.corpus.filter((item) => !entry.relevant.includes(item.id));

      return distractors.some((item) => item.category === entry.query.category);
    });

    expect(withHardNegative.length).toBeGreaterThanOrEqual(EVAL_CASES.length - 1);
  });

  it('includes a case where nothing is the item', () => {
    expect(EVAL_CASES.some((entry) => entry.relevant.length === 0)).toBe(true);
  });

  it('includes a candidate that tries to address the model', () => {
    const hostile = EVAL_CASES.flatMap((entry) => entry.corpus).some((item) =>
      /ignore all previous instructions/i.test(item.description),
    );

    expect(hostile).toBe(true);
  });

  /**
   * The property that makes every other number here worth reading.
   *
   * If a colour lookup scores as well as the retriever, the set is measuring
   * colour and the floors are measuring nothing.
   */
  it('defeats a trivial colour-equality baseline', () => {
    const trivial = scoreWith(colourOnly);
    const actual = scoreWith(retrieveLexical);

    expect(actual.mrr).toBeGreaterThan(trivial.mrr);
    expect(actual['recall@1']).toBeGreaterThan(trivial['recall@1']);
    expect(actual['ndcg@5']).toBeGreaterThan(trivial['ndcg@5']);
  });

  /** And a ranking that carries no information must score below the floor. */
  it('gives no credit to a ranking that carries no information', () => {
    const reversed = scoreWith((entry) => [...entry.corpus].map((item) => item.id).reverse());

    expect(reversed.mrr).toBeLessThan(FLOOR.mrr);
  });

  it('is counted and hashed, so a result names the data it came from', () => {
    expect(datasetHash()).toMatch(/^[0-9a-f]{12}$/);
    expect(caseCounts().positives).toBeGreaterThan(0);
  });
});

describe('retrieval quality', () => {
  it('meets the recall floor at 1', async () => {
    const report = await runEval();

    expect(report.retrieval['recall@1']).toBeGreaterThanOrEqual(FLOOR['recall@1']);
  });

  it('meets the precision floor at 1', async () => {
    const report = await runEval();

    expect(report.retrieval['precision@1']).toBeGreaterThanOrEqual(FLOOR['precision@1']);
  });

  it('meets the nDCG floor at 5', async () => {
    const report = await runEval();

    expect(report.retrieval['ndcg@5']).toBeGreaterThanOrEqual(FLOOR['ndcg@5']);
  });

  it('meets the MRR floor', async () => {
    const report = await runEval();

    expect(report.retrieval.mrr).toBeGreaterThanOrEqual(FLOOR.mrr);
  });

  /**
   * The case the lexical half exists for. An embedding blurs a service tag
   * into every other service tag; BM25 finds it exactly.
   */
  it('puts the exact serial-number match first', () => {
    const entry = EVAL_CASES.find((c) => c.id === 'serial-number');

    expect(retrieveLexical(entry!)[0]).toBe('c7');
  });

  /**
   * The case it fails, asserted as a failure rather than removed. "Apple
   * phone" against "iPhone 13" shares no token, which is the gap dense
   * retrieval closes and the reason the dense half exists at all.
   */
  it('cannot rank a paraphrase, which is what the dense half is for', () => {
    const entry = EVAL_CASES.find((c) => c.id === 'phone-paraphrase');
    const run = { ranked: retrieveLexical(entry!), relevant: new Set(entry!.relevant) };

    expect(reciprocalRank(run)).toBeLessThan(1);
  });

  it('reports a manifest that identifies the run', async () => {
    const report = await runEval();

    expect(report.manifest).toMatchObject({
      datasetHash: expect.any(String),
      promptVersion: expect.any(String),
      cases: EVAL_CASES.length,
      rerankedCases: 0,
    });
  });

  it('skips the rerank half rather than failing when no provider is given', async () => {
    const report = await runEval({ reranker: null });

    expect(report.rerank).toBeNull();
  });
});

describe('the rerank half, against a stub', () => {
  /** A perfect reranker, to prove the harness measures the reranker. */
  const oracle = {
    rerank: async (_subject: unknown, candidates: Array<{ id?: string }>) => ({
      scores: new Map(
        candidates.map((item) => {
          const relevant = EVAL_CASES.some((entry) => entry.relevant.includes(item.id as string));

          return [
            item.id as string,
            {
              id: item.id as string,
              score: relevant ? 95 : 5,
              verdict: relevant ? ('same' as const) : ('different' as const),
            },
          ];
        }),
      ),
      model: 'oracle',
      requested: candidates.length,
      ms: 0,
    }),
  };

  /**
   * Averaged over the cases that have a positive, and where retrieval put the
   * answer inside the depth the reranker is handed. A reranker cannot fix a
   * candidate it never sees, which is exactly the cascade this measures.
   */
  it('scores a perfect reranker perfectly, where retrieval gave it the chance', async () => {
    const answerable = EVAL_CASES.filter(
      (entry) =>
        entry.relevant.length > 0 && retrieveLexical(entry).slice(0, 3).includes(entry.relevant[0]),
    );

    const report = await runEval({ reranker: oracle as never, cases: answerable });

    expect(report.rerank!['precision@1']).toBe(1);
    expect(report.rerank!.mrr).toBe(1);
  });

  it('confirms nothing on the case where nothing is the item', async () => {
    const noMatch = EVAL_CASES.filter((entry) => entry.relevant.length === 0);
    const report = await runEval({ reranker: oracle as never, cases: noMatch });

    expect(report.rerank!.threshold.falsePositives).toBe(0);
  });

  it('names the model and counts the cases it answered', async () => {
    const report = await runEval({ reranker: oracle as never });

    expect(report.manifest.rerankModel).toBe('oracle');
    expect(report.manifest.rerankedCases).toBe(EVAL_CASES.length);
  });

  /**
   * A reranker that answered nothing used to report perfect precision, recall
   * and F1: with no outcomes at all every ratio had an empty denominator and
   * the empty-set convention returned 1. That is the single most flattering
   * thing this harness could say about a component that did not run.
   */
  it('reports nothing rather than a perfect score when the reranker is dead', async () => {
    const silent = { rerank: async () => null };
    const report = await runEval({ reranker: silent as never });

    expect(report.rerank!.threshold.precision).toBeNull();
    expect(report.rerank!.threshold.recall).toBeNull();
    expect(report.rerank!.threshold.f1).toBeNull();
    expect(report.manifest.rerankedCases).toBe(0);
  });

  it('falls back to the retrieved order when the reranker answers nothing', async () => {
    const silent = { rerank: async () => null };
    const report = await runEval({ reranker: silent as never });

    expect(report.rerank!.mrr).toBeCloseTo(report.retrieval.mrr);
  });
});

describe('metric sanity', () => {
  it('gives a query with no relevant item full recall rather than zero', () => {
    expect(recallAtK({ ranked: ['a', 'b'], relevant: new Set() }, 3)).toBe(1);
  });

  it('gives an empty ranking no reciprocal rank', () => {
    expect(reciprocalRank({ ranked: [], relevant: new Set(['a']) })).toBe(0);
  });

  /**
   * A repeated id counted repeatedly pushes recall past 1. Not reachable
   * today, and the failure mode is a score going *up*, so a future bug in
   * fusion or in the tail would read as an improvement rather than a fault.
   */
  it('cannot be pushed above 1 by a duplicated id', () => {
    const run = { ranked: ['a', 'a', 'a'], relevant: new Set(['a']) };

    expect(recallAtK(run, 3)).toBe(1);
    expect(ndcgAtK(run, 3)).toBe(1);
  });
});
