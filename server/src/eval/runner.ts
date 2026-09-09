/**
 * The evaluation harness (section 8.7).
 *
 * Runs the retrieval stage, and optionally the reranker, over the labelled set
 * and reports the metrics. Two things make it useful rather than decorative.
 *
 * It runs the real stages. The lexical retriever, the fusion and the reranker
 * are the same code the pipeline uses, so a number here is a number about the
 * system and not about a copy of it.
 *
 * And it runs without credentials. The retrieval half is deterministic and
 * needs no model at all, which is what lets CI fail a build on a regression;
 * the rerank half needs a provider and is skipped when there is none, so the
 * absence of a key is a smaller report rather than a failure.
 */

import { createHash } from 'node:crypto';
import { Bm25Index, isIdentifier, tokenize } from '../services/matching/retrieval/bm25.js';
import { reciprocalRankFusion } from '../services/matching/retrieval/fusion.js';
import { MAX_DENSE_DISTANCE } from '../services/matching/retrieval/retrieval.service.js';
import { PROMPT_VERSION } from '../services/matching/rerank/rerank.prompt.js';
import { createLogger } from '../utils/logger.js';
import {
  EVAL_CASES,
  caseCounts,
  datasetHash,
  toItem,
  type EvalCase,
  type EvalItem,
} from './dataset.js';
import {
  mean,
  ndcgAtK,
  precisionAtK,
  precisionRecall,
  recallAtK,
  reciprocalRank,
  type BinaryOutcome,
} from './metrics.js';
import type { Reranker } from '../services/matching/rerank/rerank.types.js';

const log = createLogger('eval');

/** The text a candidate is retrieved by. Mirrors the retrieval stage. */
function text(item: EvalItem): string {
  return [item.name, item.category, item.color, (item.tags ?? []).join(' '), item.description]
    .filter(Boolean)
    .join(' ');
}

export interface StageMetrics {
  'recall@1': number;
  'recall@3': number;
  'recall@5': number;
  'precision@1': number;
  'ndcg@5': number;
  mrr: number;
}

export interface EvalReport {
  manifest: {
    datasetHash: string;
    promptVersion: string;
    retrieval: 'lexical' | 'hybrid';
    rerankModel: string | null;
    /** Cases the reranker actually answered. Fewer than `cases` is a fallback. */
    rerankedCases: number;
    cases: number;
    pairs: number;
    positives: number;
    /**
     * The dense half scores every document in a case's own corpus, where
     * production asks for the k nearest across the whole collection and
     * intersects. At this corpus size the two rank identically, so the
     * *ordering* transfers and the *recall* is an upper bound.
     */
    denseCorpus: 'per-case, exhaustive' | null;
    at: string;
  };
  retrieval: StageMetrics;
  rerank: (StageMetrics & { threshold: ReturnType<typeof precisionRecall> }) | null;
  perCase: Array<{ id: string; retrievalRr: number; rerankRr: number | null; note: string }>;
}

function metricsFor(runs: Array<{ ranked: string[]; relevant: Set<string> }>): StageMetrics {
  return {
    'recall@1': mean(runs.map((run) => recallAtK(run, 1))),
    'recall@3': mean(runs.map((run) => recallAtK(run, 3))),
    'recall@5': mean(runs.map((run) => recallAtK(run, 5))),
    'precision@1': mean(runs.map((run) => precisionAtK(run, 1))),
    'ndcg@5': mean(runs.map((run) => ndcgAtK(run, 5))),
    mrr: mean(runs.map(reciprocalRank)),
  };
}

/**
 * Retrieval over one case, lexical only.
 *
 * Deliberately not the dense half. Dense retrieval needs model weights that a
 * CI runner would have to download, and a metric that only runs where the
 * network cooperates is a metric nobody trusts. What this measures is the
 * floor: what retrieval achieves with no vectors at all. A dense run is the
 * comparison, and it belongs in a manual run with `--dense`.
 */
/**
 * The candidates no retriever ranked, in an order that carries no information.
 *
 * Production puts them in the order the caller supplied, which is the previous
 * ordering and is meaningful there. Here the caller is the dataset file, and
 * the relevant id sat first in half the cases: a retriever that returned
 * *nothing at all* scored 84% of the shipped system's MRR, and truncating BM25
 * to its top hit — a strict degradation — scored better than not truncating
 * it. The tail was leaking the answer.
 *
 * Hashed, so it is stable across runs and unrelated to where a case was typed.
 */
/** The retrieval stage's identifier rule, mirrored so the eval measures it. */
function promoteIdentifierMatches(
  entry: EvalCase,
  fused: Array<{ id: string }>,
): Array<{ id: string }> {
  const wanted = new Set(tokenize(text(entry.query)).filter(isIdentifier));

  if (wanted.size === 0) return fused;

  const exact = new Set(
    entry.corpus
      .filter((item) => tokenize(text(item)).some((token) => wanted.has(token)))
      .map((item) => item.id),
  );

  if (exact.size === 0) return fused;

  return [
    ...fused.filter((hit) => exact.has(hit.id)),
    ...fused.filter((hit) => !exact.has(hit.id)),
  ];
}

function shuffledTail(ids: string[], seed: string): string[] {
  return [...ids].sort((a, b) => {
    const keyOf = (id: string) => createHash('sha1').update(`${seed}:${id}`).digest('hex');

    return keyOf(a).localeCompare(keyOf(b));
  });
}

export function retrieveLexical(entry: EvalCase): string[] {
  const index = new Bm25Index(entry.corpus.map((item) => ({ id: item.id, text: text(item) })));
  const hits = index.search(text(entry.query), entry.corpus.length);

  const fused = promoteIdentifierMatches(
    entry,
    reciprocalRankFusion(
      hits.length > 0 ? [{ source: 'lexical', ids: hits.map((hit) => hit.id) }] : [],
    ),
  );

  const seen = new Set(fused.map((hit) => hit.id));

  return [
    ...fused.map((hit) => hit.id),
    ...shuffledTail(
      entry.corpus.map((item) => item.id).filter((id) => !seen.has(id)),
      entry.id,
    ),
  ];
}

/** The score at or above which a pair would auto-confirm. */
export const CONFIRM_THRESHOLD = 55;

/**
 * How many retrieved candidates reach the reranker.
 *
 * Small on purpose relative to the corpora here, so a case where retrieval put
 * the answer last is a case the reranker never gets to fix.
 */
export const RERANK_DEPTH = 3;

/**
 * Retrieval over one case with the dense half as well.
 *
 * In-process cosine over the case's own corpus rather than a Firestore query:
 * the ranking a nearest-neighbour search produces over fifteen documents is
 * the same ranking an exact cosine produces, and this way the measurement
 * needs no deployed index and no seeded database. What it does need is the
 * model weights, which is why it is opt-in and not part of the CI gate.
 */
export async function retrieveHybrid(entry: EvalCase): Promise<string[]> {
  const { textEmbedder } = await import('../platform/embeddings/text.embedder.js');
  const { composeItemText } = await import('../services/embedding.service.js');

  const corpusText = entry.corpus.map((item) => composeItemText(item));
  const vectors = await textEmbedder.embed([composeItemText(entry.query), ...corpusText]);
  const [queryVector, ...itemVectors] = vectors;

  const dot = (a: Float32Array, b: Float32Array): number => {
    let total = 0;

    for (let index = 0; index < a.length; index += 1) total += a[index] * b[index];

    return total;
  };

  const dense = entry.corpus
    .map((item, index) => ({ id: item.id, similarity: dot(queryVector, itemVectors[index]) }))
    // The retrieval stage's own bound, imported rather than copied: a tuned
    // constant that left the eval measuring the old value would be a silent
    // divergence between what ships and what is reported.
    .filter((hit) => 1 - hit.similarity <= MAX_DENSE_DISTANCE)
    .sort((a, b) => b.similarity - a.similarity)
    .map((hit) => hit.id);

  const index = new Bm25Index(entry.corpus.map((item) => ({ id: item.id, text: text(item) })));
  const lexical = index.search(text(entry.query), entry.corpus.length).map((hit) => hit.id);

  const lists = [];

  if (dense.length > 0) lists.push({ source: 'dense', ids: dense });
  if (lexical.length > 0) lists.push({ source: 'lexical', ids: lexical });

  const fused = promoteIdentifierMatches(entry, reciprocalRankFusion(lists));
  const seen = new Set(fused.map((hit) => hit.id));

  return [
    ...fused.map((hit) => hit.id),
    ...shuffledTail(
      entry.corpus.map((item) => item.id).filter((id) => !seen.has(id)),
      entry.id,
    ),
  ];
}

export interface RunOptions {
  cases?: EvalCase[];
  /** Absent means the rerank half is skipped rather than failed. */
  reranker?: Reranker | null;
  /** Adds the dense retriever. Needs the model weights, so it is opt-in. */
  dense?: boolean;
}

export async function runEval(options: RunOptions = {}): Promise<EvalReport> {
  const cases = options.cases ?? EVAL_CASES;
  const counts = caseCounts(cases);

  const retrievalRuns = options.dense
    ? await Promise.all(
        cases.map(async (entry) => ({
          ranked: await retrieveHybrid(entry),
          relevant: new Set(entry.relevant),
        })),
      )
    : cases.map((entry) => ({
        ranked: retrieveLexical(entry),
        relevant: new Set(entry.relevant),
      }));

  const perCase = cases.map((entry, index) => ({
    id: entry.id,
    retrievalRr: reciprocalRank(retrievalRuns[index]),
    rerankRr: null as number | null,
    note: entry.note,
  }));

  let rerank: EvalReport['rerank'] = null;
  let rerankModel: string | null = null;
  let rerankedCases = 0;

  if (options.reranker) {
    const runs: Array<{ ranked: string[]; relevant: Set<string> }> = [];
    const outcomes: BinaryOutcome[] = [];

    for (const [index, entry] of cases.entries()) {
      // Reranking the retrieved order, not the raw corpus: that is where it
      // sits in the pipeline, and measuring it on a perfect input would
      // flatter it.
      const retrieved = retrievalRuns[index].ranked;
      const corpus = new Map(entry.corpus.map((item) => [item.id, item]));
      const candidates = retrieved
        // Only what production would hand it. Reranking the entire corpus is a
        // perfect input for recall, so a retrieval miss could never cost the
        // rerank stage anything and the cascade the harness claims to measure
        // could not be measured.
        .slice(0, RERANK_DEPTH)
        .map((id) => corpus.get(id))
        .filter((item): item is EvalItem => Boolean(item));

      const result = await options.reranker.rerank(
        toItem(entry.query, { type: 'Lost' }) as never,
        candidates.map((item) => toItem(item)),
      );

      if (!result) {
        log.warn('Rerank returned nothing for a case', { case: entry.id });

        // The same depth the reranker was given. Pushing the untruncated list
        // made the rerank metrics rise as more cases failed, because a longer
        // list has more room to contain the answer: a failure that reads as an
        // improvement is the one shape of bug this file exists to prevent.
        runs.push({
          ranked: candidates.map((item) => item.id),
          relevant: new Set(entry.relevant),
        });
        continue;
      }

      rerankedCases += 1;
      rerankModel = result.model;

      const ranked = [...candidates]
        .map((item) => ({ id: item.id, score: result.scores.get(item.id)?.score ?? -1 }))
        .sort((a, b) => b.score - a.score)
        .map((scored) => scored.id);

      runs.push({ ranked, relevant: new Set(entry.relevant) });
      perCase[index].rerankRr = reciprocalRank({ ranked, relevant: new Set(entry.relevant) });

      // End to end: would this pair have been auto-confirmed, and should it.
      candidates.forEach((item) => {
        outcomes.push({
          predicted: (result.scores.get(item.id)?.score ?? 0) >= CONFIRM_THRESHOLD,
          actual: entry.relevant.includes(item.id),
        });
      });
    }

    rerank = { ...metricsFor(runs), threshold: precisionRecall(outcomes) };
  }

  return {
    manifest: {
      datasetHash: datasetHash(cases),
      promptVersion: PROMPT_VERSION,
      retrieval: options.dense ? 'hybrid' : 'lexical',
      rerankModel,
      rerankedCases,
      denseCorpus: options.dense ? ('per-case, exhaustive' as const) : null,
      ...counts,
      at: new Date().toISOString(),
    },
    retrieval: metricsFor(retrievalRuns),
    rerank,
    perCase,
  };
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [
    'Manifest',
    `  dataset      ${report.manifest.datasetHash}`,
    `  prompt       ${report.manifest.promptVersion}`,
    `  rerank model ${report.manifest.rerankModel ?? '(not run)'}`,
    `  cases        ${report.manifest.cases}, ${report.manifest.pairs} pairs, ${report.manifest.positives} positives`,
    `  retrieval    ${report.manifest.retrieval}`,
    '',
    report.manifest.retrieval === 'hybrid'
      ? 'Retrieval (dense + lexical)'
      : 'Retrieval (lexical only)',
  ];

  Object.entries(report.retrieval).forEach(([name, value]) => {
    lines.push(`  ${name.padEnd(12)} ${value.toFixed(3)}`);
  });

  if (report.rerank) {
    lines.push('', 'Rerank');

    Object.entries(report.rerank).forEach(([name, value]) => {
      if (name === 'threshold') return;

      lines.push(`  ${name.padEnd(12)} ${(value as number).toFixed(3)}`);
    });

    const t = report.rerank.threshold;
    const show = (value: number | null) => (value === null ? '  n/a' : value.toFixed(3));

    lines.push(
      '',
      `At the auto-confirm threshold (${CONFIRM_THRESHOLD})`,
      `  precision    ${show(t.precision)}`,
      `  recall       ${show(t.recall)}`,
      `  f1           ${show(t.f1)}`,
      `  tp/fp/fn     ${t.truePositives}/${t.falsePositives}/${t.falseNegatives}`,
      `  cases        ${report.manifest.rerankedCases} of ${report.manifest.cases} answered`,
    );
  } else {
    lines.push('', 'Rerank: skipped, no AI provider configured');
  }

  lines.push('', 'Per case (reciprocal rank)');

  report.perCase.forEach((entry) => {
    const rerank = entry.rerankRr === null ? '   -  ' : entry.rerankRr.toFixed(3);

    lines.push(
      `  ${entry.id.padEnd(18)} retrieval ${entry.retrievalRr.toFixed(3)}  rerank ${rerank}`,
    );
  });

  return lines.join('\n');
}
