/**
 * The matching pipeline.
 *
 * One ordered set of stages, shared by automatic matching on item creation and
 * by manual search:
 *
 *   retrieve -> hard pre-filters -> lexical pre-score -> semantic and visual
 *   scoring -> normalisation -> threshold
 *
 * Everything above the threshold is returned ranked. Deciding what to *do* with
 * a ranked list (match records, item status, handover) belongs to the caller,
 * not here.
 *
 * The first two stages have a replacement, behind `RETRIEVAL_MODE`: hybrid
 * dense and lexical retrieval fused by rank (section 8.2, ADR 0003). It is
 * `shadow` by default, which runs it, logs how far it agrees with the
 * retrieval below, and changes nothing about which candidates are scored.
 * Turning it on is a decision to be made from those numbers, not from the fact
 * that the code exists.
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
import { mapWithConcurrency } from '../../utils/async.js';
import {
  ImageRef,
  MatchSubject,
  MatchingRunOptions,
  ScoreBreakdown,
  ScoreComponent,
  ScoredCandidate,
  SemanticScorer,
  VisualScorer,
} from './matching.types.js';
import { LlmSemanticScorer } from './semanticScorer.service.js';
import { llmReranker } from './rerank/llm.reranker.js';
import type { Reranker, RerankResult } from './rerank/rerank.types.js';
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

function notApplicable(weight: number): ScoreComponent {
  return { score: 0, weight, applicable: false };
}

function applied(score: number, weight: number): ScoreComponent {
  return { score, weight, applicable: true };
}

/**
 * Convert a Firestore timestamp to a Date, or null when there is no value.
 *
 * A missing date must fail a check, never read as "now".
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (value && typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number };

    if (typeof candidate.toDate === 'function') {
      const converted = candidate.toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }

    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000);
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
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
  semantic?: SemanticScorer;
  visual?: VisualScorer;
  retrieval?: RetrievalService;
  reranker?: Reranker;
}

export class MatchingService {
  private readonly semantic: SemanticScorer;

  private readonly visual: VisualScorer;

  private readonly retrieval: RetrievalService;

  private readonly reranker: Reranker;

  constructor(dependencies: MatchingDependencies = {}) {
    this.semantic = dependencies.semantic ?? new LlmSemanticScorer();
    this.visual = dependencies.visual ?? new ClarifaiVisualScorer();
    this.retrieval = dependencies.retrieval ?? retrievalService;
    this.reranker = dependencies.reranker ?? llmReranker;
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
  private async scoreCandidate(
    subject: MatchSubject,
    candidate: Item,
    preScore: number,
    subjectImages: ImageRef[],
    reranked: number | null,
  ): Promise<ScoredCandidate> {
    const weights = MATCH_CONFIG.WEIGHTS;
    const candidateDate = toDate(candidate.date) as Date;
    const candidateImages = imageRefs(candidate);

    // The batch already answered for this pair, so the per-pair call is not
    // made at all. That is the saving: one call for the batch instead of one
    // per candidate, not one of each.
    const [semanticRaw, visualRaw] = await Promise.all([
      reranked === null ? this.semantic.score(subject, candidate) : Promise.resolve(reranked),
      subjectImages.length > 0 && candidateImages.length > 0
        ? this.visual.score(subjectImages, candidateImages)
        : Promise.resolve(null),
    ]);

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
   * Stage 2, in whichever mode the deployment asked for.
   *
   * Returns the verdicts to use as semantic scores when the mode is `on`, and
   * null otherwise, including on failure: a reranker that cannot answer must
   * fall back to the per-pair scorer rather than leave the run without a
   * semantic component, which is what `REQUIRE_SEMANTIC_FOR_MATCH` turns into
   * no matches at all.
   */
  private async runRerank(subject: MatchSubject, candidates: Item[]): Promise<RerankResult | null> {
    const mode = env.matching.rerankMode;

    if (mode === 'off' || candidates.length === 0) return null;

    try {
      const result = await this.reranker.rerank(subject, candidates);

      if (!result) return null;

      log.info('Rerank', {
        mode,
        candidates: candidates.length,
        answered: result.scores.size,
        model: result.model,
        ms: result.ms,
      });

      return result;
    } catch (error) {
      log.warn('Rerank failed, falling back to the per-pair scorer', { error });

      return null;
    }
  }

  /**
   * What the batch would have said, against what the per-pair scorer did say.
   *
   * The number to watch is the disagreement at the threshold: a pair the
   * per-pair scorer put above it and the batch put below, or the reverse, is a
   * match that would appear or disappear the day the flag is flipped.
   *
   * Taken as an argument rather than held on the instance. Two matching runs
   * overlap whenever two reports are filed at once, and a field on a shared
   * service would let one run report the other run's verdicts.
   */
  private reportRerankShadow(result: RerankResult | null, scored: ScoredCandidate[]): void {
    if (!result) return;

    let compared = 0;
    let totalGap = 0;
    let flips = 0;

    scored.forEach((entry) => {
      const verdict = result.scores.get(entry.item.id as string);

      if (!verdict || !entry.breakdown.semantic.applicable) return;

      const semantic = entry.breakdown.semantic;

      // Back out the per-pair 0-100 from the weighted component, which is what
      // the reranked score would have replaced. The component is an integer
      // share of a weight of 50, so this recovers the value to two points;
      // immaterial for a mean gap, and worth knowing before reading one.
      const perPair = Math.round((semantic.score / semantic.weight) * 100);

      compared += 1;
      totalGap += Math.abs(perPair - verdict.score);

      // The threshold applies to the normalised final score, not to the raw
      // semantic value, so the substitution has to be carried all the way
      // through before the two are compared. Testing the raw values against
      // the final threshold counted flips that were not flips and missed ones
      // that were, which made the one number the rollout decision rests on
      // measure nothing in particular.
      const swapped = Math.round((verdict.score / 100) * semantic.weight);
      const wouldScore =
        entry.applicableWeight > 0
          ? Math.round(((entry.rawScore - semantic.score + swapped) / entry.applicableWeight) * 100)
          : 0;

      const wasAbove = entry.score >= MATCH_CONFIG.THRESHOLD;
      const wouldBeAbove = wouldScore >= MATCH_CONFIG.THRESHOLD;

      if (wasAbove !== wouldBeAbove) flips += 1;
    });

    if (compared === 0) return;

    log.info('Rerank shadow', {
      compared,
      meanGap: Math.round(totalGap / compared),
      thresholdFlips: flips,
      model: result.model,
    });
  }

  /**
   * Run the whole pipeline and return every candidate that crossed the
   * threshold, best first.
   */
  async run(
    subject: MatchSubject,
    subjectType: ItemType,
    options: MatchingRunOptions = {},
  ): Promise<{ matches: ScoredCandidate[]; evaluated: number; best: ScoredCandidate | null }> {
    const maxScored = options.maxScoredCandidates ?? DEFAULT_MAX_SCORED_CANDIDATES;
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

    const candidates = await this.retrieve(subjectType, subject.id);
    log.info(`Candidates retrieved: ${candidates.length}`);

    if (candidates.length === 0) return { matches: [], evaluated: 0, best: null };

    const eligible = candidates.filter((candidate) => this.prefilter(subject, candidate));
    log.info(`Candidates after pre-filters: ${eligible.length}`);

    if (eligible.length === 0) return { matches: [], evaluated: 0, best: null };

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

    // Started, not awaited. In `on` mode the scores decide what every candidate
    // is worth, so the scoring has to wait for them. In shadow nothing depends
    // on them at all, and awaiting first put a synchronous model call — up to
    // two sequential batches at 45 seconds each — in front of every matching
    // run on every deployment that upgraded without setting the variable.
    const reranking = this.runRerank(
      subject,
      ranked.map((entry) => entry.candidate),
    );

    const applied = env.matching.rerankMode === 'on' ? await reranking : null;

    const scored = await mapWithConcurrency(ranked, concurrency, ({ candidate, preScore }) =>
      this.scoreCandidate(
        subject,
        candidate,
        preScore,
        subjectImages,
        applied?.scores.get(candidate.id as string)?.score ?? null,
      ),
    );

    if (!applied) this.reportRerankShadow(await reranking, scored);

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

    return { matches, evaluated: scored.length, best: sorted[0] ?? null };
  }
}
