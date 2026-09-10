/**
 * The matching pipeline.
 *
 * One ordered set of stages, shared by automatic matching on item creation and
 * by manual search:
 *
 *   retrieve -> hard pre-filters -> lexical pre-score -> rerank -> visual
 *   scoring -> normalisation -> threshold -> adjudication
 *
 * Everything above the threshold is returned ranked. Deciding what to *do* with
 * a ranked list (match records, item status, handover) belongs to the caller,
 * not here.
 *
 * There is one model call in the scoring path, not one per candidate. The
 * per-pair scorer is gone: the batched reranker scores every candidate against
 * every other in a single call, which is both cheaper and better, because a
 * model shown one pair at a time cannot tell whether the wallet in front of it
 * is the only wallet or one of nine. Section 8.2 stage 2, and the arithmetic
 * behind it is in `docs/architecture/reranking-and-eval.md`.
 *
 * The first two stages have a replacement, behind `RETRIEVAL_MODE`: hybrid
 * dense and lexical retrieval fused by rank (section 8.2, ADR 0003). It is
 * `shadow` by default, which runs it, logs how far it agrees with the
 * retrieval below, and changes nothing about which candidates are scored.
 * Turning it on is a decision to be made from those numbers, not from the fact
 * that the code exists.
 *
 * The last stage has the same shape and the same default. `ADJUDICATION_MODE`
 * runs a bounded tool-using agent on the single best pair, and only when its
 * score falls in a band where the deterministic answer is genuinely unsure
 * (section 8.6). In `shadow` it records a verdict and changes nothing; in `on`
 * it may discard a pair, confirm one, or route it to a person, and it may
 * never confirm one the deterministic guards refused.
 */

import { itemRepository } from '../../repositories/item.repository.js';
import { Item, ItemType } from '../../types/index.js';
import {
  LOCATION_TEXT_MAX_SCORE,
  MATCH_CONFIG,
  calculateColorScore,
  calculateLocationScore,
  calculateTimeScore,
  getTagsWithFallback,
  haversineDistance,
  calculateTimeDifference,
} from '../../utils/scoring.js';
import { createLogger } from '../../utils/logger.js';
import { mapWithConcurrency, withTimeout } from '../../utils/async.js';
import { toDate } from '../../utils/firestore.js';
import {
  ImageRef,
  MatchSubject,
  MatchingRunOptions,
  ScoreBreakdown,
  ScoreComponent,
  ScoredCandidate,
  VisualScorer,
} from './matching.types.js';
import { llmReranker } from './rerank/llm.reranker.js';
import type { Reranker, RerankResult } from './rerank/rerank.types.js';
import { llmAdjudicator } from './adjudicate/adjudication.agent.js';
import {
  applyVerdict,
  type AdjudicationOutcome,
} from './adjudicate/adjudication.policy.js';
import type { Adjudicator, AdjudicationTrace } from './adjudicate/adjudication.types.js';
import { ClarifaiVisualScorer } from './visualScorer.service.js';
import {
  compareRetrieval,
  reportRetrieval,
  retrievalMode,
  retrievalService,
  RetrievalService,
} from './retrieval/retrieval.service.js';
import { env } from '../../config/env.js';

const log = createLogger('matching');

/**
 * How many candidates reach the semantic and visual scorers.
 *
 * The old code called the LLM once per pending item with no cap, so a single
 * request against a large collection was an unbounded bill. Candidates are
 * ordered by the cheap lexical pre-score first, so the ones most likely to
 * match are the ones that get scored.
 */
const DEFAULT_MAX_SCORED_CANDIDATES = 25;

/** Concurrent third-party calls across candidates. */
const DEFAULT_CONCURRENCY = 4;

/**
 * Slack on top of the agent's own deadline before the pipeline stops waiting.
 *
 * Enough for the run to finish the final model call it was asked for, and not
 * enough for it to keep the matching job waiting past its own timeout.
 */
const ADJUDICATION_GRACE_MS = 5_000;

/**
 * A candidate may only become a match if the semantic component ran.
 *
 * Normalising over the components that applied is right, but it means a pair
 * scored on colour, location and time alone can normalise well above the
 * threshold. Those three say two objects were in the same place at the same
 * time, not that they are the same object. With the LLM provider down that
 * would auto-match unrelated reports and open handovers, so a run without a
 * semantic verdict produces candidates and no matches.
 */
const REQUIRE_SEMANTIC_FOR_MATCH = true;

/**
 * Minimum share of the scoring model a match must be built from.
 *
 * Normalising over the components that applied is only meaningful while enough
 * of them applied. Semantic plus time alone is 60 of 100, and time proximity is
 * nearly free, so without a floor a lukewarm semantic verdict on a same-day
 * report normalises over the threshold.
 *
 * The number sits between that 60 and the 68 of semantic plus time plus a
 * text-only location, because plenty of real reports carry no coordinates and
 * must still be able to match.
 */
const MIN_APPLICABLE_WEIGHT = 65;

/** What a run with nothing to score returns. */
function emptyRun(): MatchingRunResult {
  return { matches: [], evaluated: 0, best: null, adjudication: null, adjudicationOutcome: 'unchanged' };
}

function notApplicable(weight: number): ScoreComponent {
  return { score: 0, weight, applicable: false };
}

function applied(score: number, weight: number): ScoreComponent {
  return { score, weight, applicable: true };
}

function imageRefs(source: {
  cloudinaryUrls?: string[];
  imageUrl?: string;
  imageBase64?: string;
}): ImageRef[] {
  const refs: ImageRef[] = [];

  const urls = source.cloudinaryUrls?.length
    ? source.cloudinaryUrls
    : source.imageUrl
      ? [source.imageUrl]
      : [];

  for (const url of urls) {
    if (url && url.trim()) refs.push({ kind: 'url', url });
  }

  // Manual search never uploads, so the only copy of the image is inline.
  if (source.imageBase64) refs.push({ kind: 'base64', data: source.imageBase64 });

  return refs;
}

/**
 * Cheap lexical overlap, 0-1, over tags plus name, colour and category tokens.
 *
 * This replaces the old `minCommonTags >= 1` gate. A gate on exact token
 * overlap dropped genuine matches ("iPhone 13" against "Apple phone") before
 * the semantic scorer ever saw them; as an ordering signal the same
 * information is useful and costs nothing.
 */
function lexicalPreScore(a: MatchSubject, b: Item): number {
  const tokensOf = (source: {
    tags?: string[];
    name?: string;
    color?: string;
    category?: string;
  }) => {
    const tokens = new Set(getTagsWithFallback(source.tags || [], source.name || ''));

    if (source.color) tokens.add(source.color.toLowerCase().trim());
    if (source.category) tokens.add(source.category.toLowerCase().trim());

    return tokens;
  };

  const left = tokensOf(a);
  const right = tokensOf(b);

  if (left.size === 0 || right.size === 0) return 0;

  const common = [...left].filter((token) => right.has(token)).length;

  return common / Math.min(left.size, right.size);
}

export interface MatchingDependencies {
  visual?: VisualScorer;
  retrieval?: RetrievalService;
  reranker?: Reranker;
  adjudicator?: Adjudicator;
}

/** What one run produced, including the last stage when it ran. */
export interface MatchingRunResult {
  matches: ScoredCandidate[];
  evaluated: number;
  best: ScoredCandidate | null;
  /** The stage 3 trace, when a pair fell in the band and a verdict came back. */
  adjudication: AdjudicationTrace | null;
  /** What deterministic code did with that verdict. `unchanged` in shadow. */
  adjudicationOutcome: AdjudicationOutcome;
}

export class MatchingService {
  private readonly visual: VisualScorer;

  private readonly retrieval: RetrievalService;

  private readonly reranker: Reranker;

  private readonly adjudicator: Adjudicator;

  constructor(dependencies: MatchingDependencies = {}) {
    this.visual = dependencies.visual ?? new ClarifaiVisualScorer();
    this.retrieval = dependencies.retrieval ?? retrievalService;
    this.reranker = dependencies.reranker ?? llmReranker;
    this.adjudicator = dependencies.adjudicator ?? llmAdjudicator;
  }

  /**
   * Retrieval stage: pending, admin-approved items of the opposite type.
   *
   * Moderation is filtered in memory rather than with a third `where`. An item
   * created before moderation existed has no such field, so an equality filter
   * would exclude the entire existing corpus until the migration ran, and
   * matching would quietly return nothing. A missing field reads as approved.
   */
  private async retrieve(subjectType: ItemType, excludeId?: string): Promise<Item[]> {
    const oppositeType: ItemType = subjectType === 'Lost' ? 'Found' : 'Lost';

    const candidates = await itemRepository.listPendingByType(oppositeType);

    return candidates
      .filter((item) => item.id !== excludeId)
      .filter((item) => item.moderation === undefined || item.moderation === 'approved');
  }

  /**
   * Hard pre-filters. Only the two that are cheap and unambiguous: an item too
   * far away or too long ago cannot be the same object.
   */
  private prefilter(subject: MatchSubject, candidate: Item): boolean {
    const candidateDate = toDate(candidate.date);

    if (!candidateDate) {
      log.debug(`Candidate ${candidate.id} has no report date, skipping`);
      return false;
    }

    if (subject.coordinates && candidate.coordinates) {
      const distance = haversineDistance(
        subject.coordinates.lat,
        subject.coordinates.lng,
        candidate.coordinates.lat,
        candidate.coordinates.lng,
      );

      if (distance > MATCH_CONFIG.REQUIREMENTS.maxDistance) return false;
    }

    const hours = calculateTimeDifference(subject.date, candidateDate);

    return hours <= MATCH_CONFIG.REQUIREMENTS.maxTimeDiff;
  }

  /**
   * Scoring stage for one candidate.
   */
  /**
   * The visual component for one candidate, started early and joined later.
   *
   * Never rejects: a visual scorer that throws must cost its own component and
   * not the run, and the caller holds this promise across an await on the
   * reranker, where an unhandled rejection would be a process-level warning.
   */
  private scoreVisual(subjectImages: ImageRef[], candidate: Item): Promise<number | null> {
    const candidateImages = imageRefs(candidate);

    if (subjectImages.length === 0 || candidateImages.length === 0) return Promise.resolve(null);

    return this.visual.score(subjectImages, candidateImages).catch((error: unknown) => {
      log.warn('Visual scoring failed for a candidate', { candidateId: candidate.id, error });

      return null;
    });
  }

  private async scoreCandidate(
    subject: MatchSubject,
    candidate: Item,
    preScore: number,
    visualRaw: number | null,
    reranked: number | null,
  ): Promise<ScoredCandidate> {
    const weights = MATCH_CONFIG.WEIGHTS;
    const candidateDate = toDate(candidate.date) as Date;

    // The semantic score comes from the batch and from nowhere else. A
    // candidate the batch did not answer for has no semantic component, which
    // `REQUIRE_SEMANTIC_FOR_MATCH` turns into a candidate rather than a match:
    // the safe direction, and the same one a provider outage already took.
    const semanticRaw = reranked;

    const semantic =
      semanticRaw === null
        ? notApplicable(weights.semantic)
        : applied(Math.round((semanticRaw / 100) * weights.semantic), weights.semantic);

    const image =
      visualRaw === null
        ? notApplicable(weights.image)
        : applied(Math.round((visualRaw / 100) * weights.image), weights.image);

    const hasColors = Boolean(subject.color && candidate.color);
    const color = hasColors
      ? applied(calculateColorScore(subject.color, candidate.color), weights.color)
      : notApplicable(weights.color);

    const hasCoordinates = Boolean(subject.coordinates && candidate.coordinates);
    const hasLocationText = Boolean(subject.location && candidate.location);

    // Without coordinates the scorer can never award more than the text
    // ceiling, so the full weight would be denominator the pair cannot earn.
    const locationWeight = hasCoordinates ? weights.location : LOCATION_TEXT_MAX_SCORE;
    const location =
      hasCoordinates || hasLocationText
        ? applied(
            calculateLocationScore(
              subject.coordinates,
              candidate.coordinates,
              subject.location,
              candidate.location,
            ),
            locationWeight,
          )
        : notApplicable(locationWeight);

    // The pre-filter guarantees both dates, so time always applies.
    const time = applied(calculateTimeScore(subject.date, candidateDate), weights.time);

    const breakdown: ScoreBreakdown = { semantic, color, location, time, image };
    const components = Object.values(breakdown);

    const rawScore = components.reduce(
      (total, component) => total + (component.applicable ? component.score : 0),
      0,
    );
    const applicableWeight = components.reduce(
      (total, component) => total + (component.applicable ? component.weight : 0),
      0,
    );

    // Normalise against what actually ran. Dividing by a hardcoded
    // `100 - image` meant an unconfigured Clarifai silently cost every pair the
    // full image weight, which is what stopped matching working at all.
    const score = applicableWeight > 0 ? Math.round((rawScore / applicableWeight) * 100) : 0;

    log.debug(
      `[${candidate.id}] semantic:${semantic.score}/${semantic.applicable ? semantic.weight : 'n/a'} ` +
        `color:${color.score}/${color.applicable ? color.weight : 'n/a'} ` +
        `location:${location.score}/${location.applicable ? location.weight : 'n/a'} ` +
        `time:${time.score}/${time.weight} ` +
        `image:${image.score}/${image.applicable ? image.weight : 'n/a'} ` +
        `raw:${rawScore}/${applicableWeight} => ${score}`,
    );

    return { item: candidate, score, rawScore, applicableWeight, breakdown, preScore };
  }

  /**
   * Hybrid retrieval, in whichever mode the deployment asked for.
   *
   * Returns the candidates to score when the mode is `on`, and null in every
   * other case, including a failure: a retrieval stage that cannot run must
   * fall back to the one it replaces rather than fail a matching run.
   */
  private async runHybridRetrieval(
    subject: MatchSubject,
    subjectType: ItemType,
    ordered: Array<{ candidate: Item; date: Date; preScore: number; hoursApart: number }>,
    maxScored: number,
  ): Promise<Array<{ candidate: Item; preScore: number }> | null> {
    const mode = retrievalMode();

    if (mode === 'off') return null;

    try {
      // The candidates this run already read and filtered, dates and all.
      // Retrieval used to query the collection again, which doubled the reads
      // on every matching run to rebuild a subset of this exact list.
      const result = await this.retrieval.retrieve(
        subject,
        subjectType,
        env.matching.retrievalLimit,
        ordered.map(({ candidate, date }) => ({ item: candidate, date })),
      );

      if (mode === 'shadow') {
        compareRetrieval(
          ordered.map((entry) => entry.candidate.id as string),
          result,
          maxScored,
        );

        return null;
      }

      if (result.candidates.length === 0) {
        log.warn('Hybrid retrieval found nothing, falling back to the lexical ordering');

        return null;
      }

      const chosen = result.candidates.slice(0, maxScored);

      reportRetrieval(result, chosen.length);

      return chosen.map(({ item }) => ({
        candidate: item,
        preScore: lexicalPreScore(subject, item),
      }));
    } catch (error) {
      log.warn('Hybrid retrieval failed, falling back to the lexical ordering', { error });

      return null;
    }
  }

  /**
   * Stage 2: the batched reranker, and the only semantic scorer there is.
   *
   * The per-pair scorer this replaced called a model once per candidate, so
   * twenty-five candidates was twenty-five calls, twenty-five timeouts and
   * twenty-five chances for one of them to fail. It is gone (section 8.2), and
   * with it the fallback that used to catch a rerank failure.
   *
   * Losing that fallback is deliberate rather than accidental. The two scorers
   * shared a provider, so they failed together anyway, and the reranker
   * already degrades where it matters: batches are scored independently, a
   * batch that fails costs its own candidates and not the run, and a candidate
   * with no verdict keeps whatever the rest of the pipeline can say about it.
   * What it cannot do is become a match, because a run with no semantic
   * verdict must produce candidates and no matches rather than pair two
   * reports on colour and time alone.
   */
  private async runRerank(subject: MatchSubject, candidates: Item[]): Promise<RerankResult | null> {
    if (candidates.length === 0) return null;

    try {
      const result = await this.reranker.rerank(subject, candidates);

      if (!result) {
        log.warn('Rerank produced no verdicts; this run can return candidates but no matches', {
          candidates: candidates.length,
        });

        return null;
      }

      log.info('Rerank', {
        candidates: candidates.length,
        answered: result.scores.size,
        model: result.model,
        ms: result.ms,
      });

      if (result.scores.size < candidates.length) {
        log.info('Rerank did not answer for every candidate', {
          unanswered: candidates.length - result.scores.size,
        });
      }

      return result;
    } catch (error) {
      log.warn('Rerank failed; this run can return candidates but no matches', { error });

      return null;
    }
  }

  /**
   * Run the whole pipeline and return every candidate that crossed the
   * threshold, best first.
   */
  async run(
    subject: MatchSubject,
    subjectType: ItemType,
    options: MatchingRunOptions = {},
  ): Promise<MatchingRunResult> {
    const maxScored = options.maxScoredCandidates ?? DEFAULT_MAX_SCORED_CANDIDATES;
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

    const candidates = await this.retrieve(subjectType, subject.id);
    log.info(`Candidates retrieved: ${candidates.length}`);

    if (candidates.length === 0) return emptyRun();

    const eligible = candidates.filter((candidate) => this.prefilter(subject, candidate));
    log.info(`Candidates after pre-filters: ${eligible.length}`);

    if (eligible.length === 0) return emptyRun();

    // Order by the cheap signal, then spend the expensive calls on the head.
    // Lexical overlap ties on zero for genuine matches with disjoint wording,
    // so time proximity breaks the tie rather than Firestore's arbitrary order.
    const ordered = eligible
      .map((candidate) => {
        // The pre-filter already guaranteed and parsed this; carrying it means
        // neither the sort nor the retrieval stage converts it again.
        const date = toDate(candidate.date) as Date;

        return {
          candidate,
          date,
          preScore: lexicalPreScore(subject, candidate),
          hoursApart: calculateTimeDifference(subject.date, date),
        };
      })
      .sort((a, b) => b.preScore - a.preScore || a.hoursApart - b.hoursApart);

    const hybrid = await this.runHybridRetrieval(subject, subjectType, ordered, maxScored);
    const ranked = hybrid ?? ordered.slice(0, maxScored);

    // Only meaningful for the lexical ordering. Under hybrid retrieval the
    // field was narrowed by rank fusion, so counting candidates with no
    // lexical overlap would describe a decision nothing made.
    if (!hybrid && ordered.length > ranked.length) {
      const droppedWithoutOverlap = ordered
        .slice(maxScored)
        .filter((entry) => entry.preScore === 0).length;

      log.info(
        `Scoring the top ${ranked.length} of ${ordered.length} candidates by lexical overlap` +
          (droppedWithoutOverlap > 0
            ? `; ${droppedWithoutOverlap} dropped candidate(s) had no lexical overlap and were never semantically scored`
            : ''),
      );
    }

    const subjectImages = imageRefs(subject);

    // Awaited, because these scores decide what every candidate is worth.
    // Its own wall clock bounds it, which matters more now than it did as a
    // shadow: the whole matching run happens inside a job attempt killed at
    // two minutes, and this is the only model call left in the scoring path.
    // Started before the rerank is awaited, because the two are independent and
    // the visual scorer is not cheap: its provider allows three concurrent
    // concept fetches at ten seconds each, so a full field is tens of seconds
    // that used to overlap the rerank and would otherwise now follow it. The
    // scorer has its own concurrency limiter, so starting them all is a queue
    // rather than a stampede.
    const visualScores = new Map(
      ranked.map(({ candidate }) => [
        candidate.id as string,
        this.scoreVisual(subjectImages, candidate),
      ]),
    );

    const applied = await this.runRerank(
      subject,
      ranked.map((entry) => entry.candidate),
    );

    const scored = await mapWithConcurrency(ranked, concurrency, async ({ candidate, preScore }) =>
      this.scoreCandidate(
        subject,
        candidate,
        preScore,
        (await visualScores.get(candidate.id as string)) ?? null,
        applied?.scores.get(candidate.id as string)?.score ?? null,
      ),
    );

    const sorted = [...scored].sort((a, b) => b.score - a.score);

    const aboveThreshold = sorted.filter((entry) => entry.score >= MATCH_CONFIG.THRESHOLD);
    const matches = aboveThreshold.filter((entry) => {
      if (REQUIRE_SEMANTIC_FOR_MATCH && !entry.breakdown.semantic.applicable) return false;
      return entry.applicableWeight >= MIN_APPLICABLE_WEIGHT;
    });

    if (matches.length < aboveThreshold.length) {
      log.warn(
        `${aboveThreshold.length - matches.length} candidate(s) scored above threshold on too little evidence and were not treated as matches`,
      );
    }

    // The best candidate the pipeline could actually assess, not the highest
    // number it produced. Normalising over the components that applied means a
    // candidate the reranker never answered for is scored out of a smaller
    // denominator, so it can outrank one that was answered: 44 of 50 reads as
    // 88 while the same evidence plus a reranked 85 reads as 86. Taking that
    // as `best` would hand the adjudication agent a pair it can never confirm
    // and write its inflated percentage onto the item as the closest thing
    // found — for every report filed while the provider is down.
    const best = sorted.find((entry) => entry.breakdown.semantic.applicable) ?? null;

    if (!best && sorted.length > 0) {
      log.warn('No candidate was semantically assessed, so this run has no best candidate', {
        evaluated: sorted.length,
      });
    }

    const adjudicated = await this.runAdjudication(subject, subjectType, best, matches);

    return {
      matches: adjudicated.matches,
      evaluated: scored.length,
      best,
      adjudication: adjudicated.trace,
      adjudicationOutcome: adjudicated.outcome,
    };
  }

  /**
   * Stage 3: the adjudication agent, on the single best pair and only inside
   * the uncertainty band.
   *
   * Everything about this is deliberately rare. One pair, not three: the plan's
   * budget is one agent run per report, and adjudicating the runner-up as well
   * would double the cost to decide something the winner already settled. Only
   * inside the band, because above it the pair is confirmed without asking and
   * below it discarded without asking, and paying for a verdict about a
   * decision already made is the failure mode this stage exists to avoid.
   *
   * A failure changes nothing. An agent that cannot be reached, cannot finish
   * or cannot answer leaves the deterministic result exactly as it was, which
   * is the same rule the two stages before it follow.
   */
  private async runAdjudication(
    subject: MatchSubject,
    subjectType: ItemType,
    best: ScoredCandidate | null,
    matches: ScoredCandidate[],
  ): Promise<{
    matches: ScoredCandidate[];
    trace: AdjudicationTrace | null;
    outcome: AdjudicationOutcome;
  }> {
    const mode = env.matching.adjudicationMode;

    if (mode === 'off' || !best) return { matches, trace: null, outcome: 'unchanged' };

    const { adjudicationBandLow: low, adjudicationBandHigh: high } = env.matching;

    if (best.score < low || best.score >= high) {
      return { matches, trace: null, outcome: 'unchanged' };
    }

    const candidateId = best.item.id as string;
    const wasMatch = matches.some((entry) => entry.item.id === candidateId);
    const eligible =
      (!REQUIRE_SEMANTIC_FOR_MATCH || best.breakdown.semantic.applicable) &&
      best.applicableWeight >= MIN_APPLICABLE_WEIGHT;

    // A pair that is neither a match nor eligible to become one cannot be moved
    // by any verdict: every branch of `applyVerdict` returns `unchanged` for
    // it. Running the agent anyway spends a model call and up to the whole
    // adjudication budget of the matching job's two minutes to learn nothing,
    // and the case is not exotic — it is what a provider outage produces, at
    // which point the agent shares the dead provider.
    if (!wasMatch && !eligible) {
      log.info('Skipping adjudication: no verdict could change this pair', {
        candidateId,
        pipelineScore: best.score,
      });

      return { matches, trace: null, outcome: 'unchanged' };
    }

    let trace: AdjudicationTrace | null = null;

    try {
      // A hard ceiling on top of the agent's own budget. The agent checks its
      // deadline between turns, so a run can legitimately end one provider
      // timeout past it; this whole stage is awaited inside a `match.item`
      // attempt that is killed at 120 seconds and retried twice, and the
      // stages before it have already spent most of that. A wait nobody
      // bounded here is a matching run that dead-letters without writing a
      // single match record, which is a strictly worse outcome than never
      // having adjudicated.
      trace = await withTimeout(
        this.adjudicator.adjudicate({
          subject,
          subjectType,
          candidate: best.item,
          pipelineScore: best.score,
        }),
        env.matching.adjudicationDeadlineMs + ADJUDICATION_GRACE_MS,
        'adjudication',
      );
    } catch (error) {
      log.warn('Adjudication failed, leaving the deterministic result standing', { error });
    }

    if (!trace) return { matches, trace: null, outcome: 'unchanged' };

    const outcome = applyVerdict(trace, {
      wasMatch,
      aboveThreshold: best.score >= MATCH_CONFIG.THRESHOLD,
      // The same two evidence guards the threshold filter applies, so a
      // verdict can never confirm a pair the deterministic evidence refused.
      eligible,
      minConfidence: env.matching.adjudicationMinConfidence,
      mode: mode === 'on' ? 'on' : 'shadow',
    });

    log.info('Adjudication', {
      candidateId,
      pipelineScore: best.score,
      decision: trace.verdict.decision,
      confidence: trace.verdict.confidence,
      wasMatch,
      outcome,
      mode,
      toolCalls: trace.toolCalls,
      stoppedBy: trace.stoppedBy,
      ms: trace.ms,
      costUsd: Number(trace.costUsd.toFixed(6)),
    });

    if (outcome === 'discard') {
      return {
        matches: matches.filter((entry) => entry.item.id !== candidateId),
        trace,
        outcome,
      };
    }

    // Both add the pair to the matched set, and they differ in what happens
    // next: `confirm` leaves it on the automatic path, `human_review` writes
    // the same record and stops before the handover.
    if ((outcome === 'confirm' || outcome === 'human_review') && !wasMatch) {
      // Ahead of the rest: this is the highest-scoring candidate of the run,
      // so the sort order the caller relies on is preserved by prepending.
      return { matches: [best, ...matches], trace, outcome };
    }

    return { matches, trace, outcome };
  }
}
