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
 */

import { collections } from '../../utils/firebase-admin.js';
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
import { ClarifaiVisualScorer } from './visualScorer.service.js';

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
}

export class MatchingService {
  private readonly semantic: SemanticScorer;

  private readonly visual: VisualScorer;

  constructor(dependencies: MatchingDependencies = {}) {
    this.semantic = dependencies.semantic ?? new LlmSemanticScorer();
    this.visual = dependencies.visual ?? new ClarifaiVisualScorer();
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

    const snapshot = await collections.items
      .where('type', '==', oppositeType)
      .where('status', '==', 'Pending')
      .get();

    return snapshot.docs
      .filter((doc) => doc.id !== excludeId)
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Item)
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
  ): Promise<ScoredCandidate> {
    const weights = MATCH_CONFIG.WEIGHTS;
    const candidateDate = toDate(candidate.date) as Date;
    const candidateImages = imageRefs(candidate);

    const [semanticRaw, visualRaw] = await Promise.all([
      this.semantic.score(subject, candidate),
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
      .map((candidate) => ({
        candidate,
        preScore: lexicalPreScore(subject, candidate),
        hoursApart: calculateTimeDifference(subject.date, toDate(candidate.date) as Date),
      }))
      .sort((a, b) => b.preScore - a.preScore || a.hoursApart - b.hoursApart);

    const ranked = ordered.slice(0, maxScored);

    if (ordered.length > ranked.length) {
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

    const scored = await mapWithConcurrency(ranked, concurrency, ({ candidate, preScore }) =>
      this.scoreCandidate(subject, candidate, preScore, subjectImages),
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

    return { matches, evaluated: scored.length, best: sorted[0] ?? null };
  }
}
