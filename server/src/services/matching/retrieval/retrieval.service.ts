/**
 * Stage 1 of the pipeline in section 8.2: retrieve.
 *
 * The pipeline above owns stage 0. It has already read the pending items of
 * the opposite type and applied the hard filters — self, moderation, the
 * distance limit and the time window — so this takes that set and does not
 * read it again. An earlier draft did its own query here, which doubled the
 * Firestore reads on every matching run to produce a subset of what the caller
 * already held.
 *
 * What this stage does is decide which of those candidates are worth the
 * expensive scorers, using two retrievers that fail in opposite directions:
 *
 *   dense    nearest neighbours over the item vectors. Handles "Apple phone"
 *            against "iPhone 13"; blurs a serial number into every other one.
 *   lexical  BM25 over the same set. Finds the serial number, the model
 *            string, the name written inside a bag; blind to a synonym.
 *
 * Fused by rank, because their scores are not on a comparable scale.
 *
 * Nothing here decides whether a pair is a match. This orders the field; the
 * scorers above still do the deciding.
 */

import { itemRepository } from '../../../repositories/item.repository.js';
import { composeItemText, embeddingService } from '../../embedding.service.js';
import { firestoreVectorIndex } from '../../../platform/vector/firestore.vector.index.js';
import { similarityFromDistance, type VectorIndex } from '../../../platform/vector/vector.port.js';
import { env } from '../../../config/env.js';
import { createLogger } from '../../../utils/logger.js';
import { Item, ItemType } from '../../../types/index.js';
import { Bm25Index, isIdentifier, tokenize } from './bm25.js';
import { reciprocalRankFusion, type RankedList } from './fusion.js';
import type { MatchSubject } from '../matching.types.js';

const log = createLogger('matching:retrieval');

/**
 * How far past `limit` the dense query reaches.
 *
 * Firestore can only pre-filter a vector query on equality, so `type` and
 * `status` go into the query and the time window and distance limit do not.
 * Those are applied by intersecting the hits with the caller's already
 * filtered set, and this leaves room for what that removes.
 */
const DENSE_OVERFETCH = 4;

/**
 * The furthest a neighbour may be and still be a candidate, as a Firestore
 * COSINE distance, which is `1 - cosine similarity`.
 *
 * A nearest-neighbour query returns the k nearest however far away they are,
 * so without a bound a corpus containing nothing related still yields k
 * confident-looking candidates. The number comes from the phase 22
 * measurements on this encoder: two descriptions of the same wallet scored
 * 0.865 cosine, a wallet against a bicycle 0.619, which are distances of 0.135
 * and 0.381. 0.35 sits below the unrelated pair and well above the true one.
 */
export const MAX_DENSE_DISTANCE = 0.35;

/** A candidate the caller has already filtered, with its date parsed once. */
export interface EligibleCandidate {
  item: Item;
  date: Date;
}

export interface RetrievalCandidate {
  item: Item;
  /** Cosine similarity, or null when the dense retriever did not return it. */
  denseSimilarity: number | null;
  /** Rank per retriever, so a candidate can explain why it is here. */
  ranks: Record<string, number>;
}

export interface RetrievalResult {
  candidates: RetrievalCandidate[];
  /** How many the caller offered, before retrieval ordered them. */
  filtered: number;
  denseUsed: boolean;
  ms: number;
}

/**
 * The text a candidate is matched on lexically.
 *
 * Deliberately not the text it was embedded from: BM25 wants the raw words,
 * and the separators `composeItemText` uses are tokenised away anyway.
 */
function lexicalText(source: {
  name?: string;
  category?: string;
  color?: string;
  tags?: string[];
  description?: string;
}): string {
  return [
    source.name,
    source.category,
    source.color,
    (source.tags ?? []).join(' '),
    source.description,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Candidates that share an identifier with the subject.
 *
 * A serial number, a model number, an IMEI, a registration: two reports
 * carrying the same one are describing the same object, and no amount of
 * agreement about "black" and "headphones" is comparable evidence.
 *
 * Measured on the labelled set, promoting these ahead of the fused order takes
 * recall@1 from 0.778 to 0.889. It matters most in the hybrid case, where the
 * dense retriever blurs an identifier into every other identifier and can pull
 * a candidate the lexical half ranked first back down the list.
 */
function identifierMatches(subject: MatchSubject, tokensById: Map<string, string[]>): Set<string> {
  const wanted = new Set(tokenize(lexicalText(subject)).filter(isIdentifier));

  if (wanted.size === 0) return new Set();

  const matched = new Set<string>();

  tokensById.forEach((tokens, id) => {
    if (tokens.some((token) => wanted.has(token))) matched.add(id);
  });

  return matched;
}

export class RetrievalService {
  constructor(
    private readonly index: VectorIndex = firestoreVectorIndex,
    private readonly embeddings = embeddingService,
    private readonly items = itemRepository,
  ) {}

  /**
   * The subject's own vector.
   *
   * Computed here when the item does not have one stored, rather than waiting
   * for the embedding job. A report and its matching run leave the same outbox
   * event onto queues consumed concurrently, so a brand-new item usually
   * reaches matching before it has been embedded. Chaining the two jobs would
   * fix the order and couple them, so an embedding that dead-lettered would
   * take matching with it; embedding the text here costs about ten
   * milliseconds and is cached.
   *
   * `composeItemText` and not `lexicalText`: this has to be the exact string
   * every stored vector was produced from, or the query is drawn from a
   * slightly different point than the documents it is compared against and the
   * content-hash cache can never hit.
   */
  private async subjectVector(subject: MatchSubject): Promise<Float32Array | null> {
    if (!this.embeddings.isEnabled()) return null;

    if (subject.id) {
      const stored = await this.items.findByIdWithVectors(subject.id);

      if (stored?.embedding) return stored.embedding;
    }

    const text = composeItemText(subject);

    if (!text.trim()) return null;

    const [vector] = await this.embeddings.embedTexts([text]);

    return vector ?? null;
  }

  /**
   * Order the caller's candidates, best first.
   *
   * The result is always as long as `limit` allows: what the retrievers found,
   * then the rest of the eligible set in the order the caller gave it. A
   * retriever that matched only two of forty candidates must not shrink the
   * field to two, which is the exact hard token-overlap gate the pipeline
   * removed for dropping "iPhone 13" against "Apple phone".
   */
  async retrieve(
    subject: MatchSubject,
    subjectType: ItemType,
    limit: number,
    eligible: EligibleCandidate[],
  ): Promise<RetrievalResult> {
    const started = Date.now();

    if (eligible.length === 0) {
      return { candidates: [], filtered: 0, denseUsed: false, ms: Date.now() - started };
    }

    // The caller already excludes the subject, but this stage hands back a
    // list somebody scores, and a self-match is the one candidate that is
    // always wrong. Cheap enough to guarantee rather than assume.
    const candidates = eligible.filter(({ item }) => item.id !== subject.id);

    if (candidates.length === 0) {
      return { candidates: [], filtered: 0, denseUsed: false, ms: Date.now() - started };
    }

    const byId = new Map(candidates.map(({ item }) => [item.id as string, item]));
    const lists: RankedList[] = [];
    const denseSimilarity = new Map<string, number>();

    const vector = await this.subjectVector(subject);

    if (vector) {
      const oppositeType: ItemType = subjectType === 'Lost' ? 'Found' : 'Lost';
      // Sized against the candidate set as well as the limit: the query ranks
      // the whole collection, and the time and distance limits are applied
      // afterwards, so a small k over a national corpus can intersect to
      // nothing exactly as the corpus grows.
      const k = Math.max(limit * DENSE_OVERFETCH, candidates.length);

      const hits = await this.index.search(vector, { type: oppositeType, status: 'Pending' }, k, {
        maxDistance: MAX_DENSE_DISTANCE,
      });

      const dense = hits
        // Intersected with what the caller filtered: the query could only
        // enforce two of the predicates, so a hit six months old or two
        // hundred kilometres away is dropped here rather than left in.
        .filter((hit) => byId.has(hit.id) && hit.id !== subject.id)
        .map((hit) => {
          denseSimilarity.set(hit.id, similarityFromDistance(hit.distance));

          return hit.id;
        });

      if (dense.length > 0) lists.push({ source: 'dense', ids: dense });
    }

    // Tokenised once and reused: the identifier rule below needs the same
    // terms the index was built from, and running the tokeniser a second time
    // over every candidate is work proportional to the whole set.
    const tokensById = new Map(
      candidates.map(({ item }) => [item.id as string, tokenize(lexicalText(item))]),
    );

    const lexical = new Bm25Index(
      candidates.map(({ item }) => ({ id: item.id as string, text: lexicalText(item) })),
    ).search(lexicalText(subject), limit * DENSE_OVERFETCH);

    if (lexical.length > 0) {
      lists.push({ source: 'lexical', ids: lexical.map((hit) => hit.id) });
    }

    const fused = reciprocalRankFusion(lists);

    // Stable, so an identifier match keeps its position relative to the other
    // identifier matches and only moves ahead of the candidates without one.
    const exact = identifierMatches(subject, tokensById);
    const ordered =
      exact.size > 0
        ? [
            ...fused.filter((hit) => exact.has(hit.id)),
            ...fused.filter((hit) => !exact.has(hit.id)),
          ]
        : fused;

    const ranked = ordered
      .map((hit) => ({
        item: byId.get(hit.id) as Item,
        denseSimilarity: denseSimilarity.get(hit.id) ?? null,
        ranks: hit.ranks,
      }))
      .filter((candidate) => Boolean(candidate.item));

    // Everything the retrievers did not rank, in the order the caller gave it,
    // which is the ordering this stage would otherwise be discarding.
    const seen = new Set(ranked.map((candidate) => candidate.item.id));
    const rest = candidates
      .filter(({ item }) => !seen.has(item.id))
      .map(({ item }) => ({ item, denseSimilarity: null, ranks: {} }));

    return {
      candidates: [...ranked, ...rest].slice(0, limit),
      filtered: candidates.length,
      denseUsed: denseSimilarity.size > 0,
      ms: Date.now() - started,
    };
  }
}

export const retrievalService = new RetrievalService();

/** Off, measured against the current retrieval, or actually used. */
export function retrievalMode(): 'off' | 'shadow' | 'on' {
  return env.matching.retrievalMode;
}

/**
 * What the shadow run reports.
 *
 * The question a shadow answers is not "is the new retrieval good" but "would
 * it have kept what the old one kept": overlap at the point where the
 * expensive scorers stop. A low overlap before the flag is flipped is the
 * signal to look, not a reason the flag cannot be flipped.
 */
export function compareRetrieval(
  legacyIds: string[],
  retrieved: RetrievalResult,
  scoredDepth: number,
): void {
  const legacyHead = new Set(legacyIds.slice(0, scoredDepth));
  const newHead = retrieved.candidates.slice(0, scoredDepth).map((candidate) => candidate.item.id);
  const kept = newHead.filter((id) => legacyHead.has(id as string)).length;

  log.info('Retrieval shadow', {
    filtered: retrieved.filtered,
    denseUsed: retrieved.denseUsed,
    legacyHead: legacyHead.size,
    newHead: newHead.length,
    overlap: kept,
    ms: retrieved.ms,
  });
}

/**
 * What the live run reports.
 *
 * `denseUsed` matters more here than in shadow: once the flag is on, a dense
 * half that never contributes — an undeployed index, an unembedded corpus — is
 * invisible unless it is counted, and the symptom is only that matching quietly
 * gets worse.
 */
export function reportRetrieval(retrieved: RetrievalResult, scored: number): void {
  log.info('Retrieval', {
    filtered: retrieved.filtered,
    retrieved: retrieved.candidates.length,
    scored,
    denseUsed: retrieved.denseUsed,
    ms: retrieved.ms,
  });
}
