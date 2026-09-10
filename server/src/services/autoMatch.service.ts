/**
 * Automatic matching on item creation.
 *
 * The entry point onto `MatchingService`. It used to be one of two; the other
 * was a search route with no caller anywhere in the client, which phase 18
 * removed along with the wrapper it went through.
 *
 * Scoring lives entirely in the pipeline. What is left here is the part
 * specific to the create path: persisting match records, moving item status,
 * and starting exactly one handover.
 */

import { itemRepository } from '../repositories/item.repository.js';
import { matchRepository } from '../repositories/match.repository.js';
import { ItemType } from '../types/index.js';
import { FieldValue } from 'firebase-admin/firestore';
import { MATCH_CONFIG } from '../utils/scoring.js';
import { initiateHandover } from './handover.service.js';
import { createLogger } from '../utils/logger.js';
import { MatchingService } from './matching/matching.pipeline.js';
import { MatchSubject, ScoredCandidate } from './matching/matching.types.js';
import { blocksAutoHandover } from './matching/adjudicate/adjudication.policy.js';
import type { AdjudicationTrace } from './matching/adjudicate/adjudication.types.js';
import type { AdjudicationRecord } from '../types/index.js';

const log = createLogger('autoMatch');

export interface AutoMatchInput {
  name: string;
  description: string;
  tags: string[];
  color?: string;
  imageUrl?: string;
  cloudinaryUrls?: string[];
  coordinates?: { lat: number; lng: number };
  location: string;
  category?: string;
  date?: Date;
  /** Read only by the adjudication agent's claim-history tool. */
  reportedBy?: string;
}

export interface AutoMatchResult {
  bestMatchId?: string;
  highestScore: number;
  /** True when the adjudication agent sent the winning pair to a person. */
  awaitingReview?: boolean;
}

/**
 * Orientation-independent lookup.
 *
 * Checking only `(lostItemId, foundItemId)` let the reversed pair create a
 * second record for the same physical pairing.
 */
async function findExistingMatchId(
  lostItemId: string,
  foundItemId: string,
): Promise<string | null> {
  const [forward, reverse] = await Promise.all([
    matchRepository.findByPair(lostItemId, foundItemId),
    matchRepository.findByPair(foundItemId, lostItemId),
  ]);

  return forward?.id ?? reverse?.id ?? null;
}

/**
 * The agent's trace, trimmed to what an admin screen needs.
 *
 * Stored on the match record so the reasoning survives the run that produced
 * it (section 8.6). The transcript is not stored: it is several kilobytes of
 * model-written text per match, and every fact in it that mattered is already
 * in `steps` and `evidence`.
 */
function adjudicationRecordFrom(trace: AdjudicationTrace): AdjudicationRecord {
  return {
    decision: trace.verdict.decision,
    confidence: trace.verdict.confidence,
    evidence: trace.verdict.evidence,
    contradictions: trace.verdict.contradictions,
    steps: trace.steps.map((step) => ({
      tool: step.tool,
      args: step.args,
      result: step.result,
      failed: step.failed ?? false,
    })),
    toolCalls: trace.toolCalls,
    stoppedBy: trace.stoppedBy,
    model: trace.model,
    provider: trace.provider,
    promptVersion: trace.promptVersion,
    costUsd: Number(trace.costUsd.toFixed(6)),
    ms: trace.ms,
    mode: trace.mode,
    pipelineScore: trace.pipelineScore,
  };
}

/**
 * The trace, but only if it is about this pair.
 *
 * Attribution used to be positional — "is this `matches[0]`" — and that is
 * wrong in three ways the pipeline can produce: a discard removes the
 * adjudicated pair from `matches` so the runner-up takes position zero, a pair
 * that failed the evidence guards was never in `matches` at all, and a
 * sub-threshold pair sits below one that passed. Each of those wrote one
 * pair's reasoning onto another pair's record, and because the stored record
 * dropped the ids it was unverifiable afterwards.
 *
 * The trace names the pair it judged. That is what decides.
 */
function traceForPair(
  trace: AdjudicationTrace | null,
  lostItemId: string,
  foundItemId: string,
): AdjudicationTrace | null {
  if (!trace) return null;

  return trace.lostItemId === lostItemId && trace.foundItemId === foundItemId ? trace : null;
}

function matchRecordFrom(
  lostItemId: string,
  foundItemId: string,
  candidate: ScoredCandidate,
  adjudication: AdjudicationTrace | null,
  handoverHeld: boolean,
): Record<string, unknown> {
  const { breakdown } = candidate;

  return {
    lostItemId,
    foundItemId,
    semanticScore: breakdown.semantic.score,
    tagScore: breakdown.semantic.score, // Mapped for frontend compatibility
    descriptionScore: 0,
    colorScore: breakdown.color.score,
    categoryScore: 0,
    locationScore: breakdown.location.score,
    timeScore: breakdown.time.score,
    imageScore: breakdown.image.score,
    matchScore: candidate.score,
    status: 'matched' as const,
    ...(adjudication ? { adjudication: adjudicationRecordFrom(adjudication) } : {}),
    // Written rather than derived, so the admin list can show a held pair
    // without opening every record and reading the trace inside it.
    ...(handoverHeld ? { handoverHeld: true } : {}),
    createdAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Trigger automatic matching for a newly created item.
 */
export async function triggerAutoMatching(
  itemId: string,
  itemType: ItemType,
  itemData: AutoMatchInput,
): Promise<AutoMatchResult | null> {
  log.info(
    `[AUTO-MATCH] Starting for item ${itemId} (${itemType}), threshold ${MATCH_CONFIG.THRESHOLD}%`,
  );

  try {
    if (!itemData.date) {
      log.warn(`[AUTO-MATCH] Item ${itemId} has no report date, skipping matching`);
      return { highestScore: 0 };
    }

    const subject: MatchSubject = {
      id: itemId,
      name: itemData.name,
      description: itemData.description,
      tags: itemData.tags,
      color: itemData.color,
      category: itemData.category,
      location: itemData.location,
      coordinates: itemData.coordinates,
      date: itemData.date,
      cloudinaryUrls: itemData.cloudinaryUrls,
      imageUrl: itemData.imageUrl,
      reportedBy: itemData.reportedBy,
    };

    const pipeline = new MatchingService();
    const { matches, best, adjudication, adjudicationOutcome } = await pipeline.run(
      subject,
      itemType,
    );
    const awaitingReview = blocksAutoHandover(adjudicationOutcome);

    if (matches.length === 0) {
      // A best score below the threshold is a candidate, not a match. Writing
      // it to `matchScore` made the UI show a match percentage for an item
      // that has none.
      //
      // A discarded pair is not even a candidate: the agent has just rejected
      // it on evidence, so stamping the item with its score would surface the
      // rejected pair's number as the closest thing found.
      if (best && adjudicationOutcome !== 'discard') {
        await itemRepository.patch(itemId, { bestCandidateScore: best.score });
      }

      log.info(`[AUTO-MATCH] No matches for item ${itemId} (best candidate ${best?.score ?? 0}%)`);
      return { highestScore: 0 };
    }

    // 1. Persist a record for every match. No side effects in this loop.
    const created: Array<{ matchId: string; candidate: ScoredCandidate }> = [];

    for (const candidate of matches) {
      const candidateId = candidate.item.id;
      const lostItemId = itemType === 'Lost' ? itemId : candidateId;
      const foundItemId = itemType === 'Found' ? itemId : candidateId;

      const existingId = await findExistingMatchId(lostItemId, foundItemId);
      // Only the adjudicated pair carries a trace, and which pair that was is
      // decided by the ids on the trace, never by position in this list.
      const trace = traceForPair(adjudication, lostItemId, foundItemId);
      const held = Boolean(trace) && awaitingReview;

      if (existingId) {
        // A rematch of a pair that already has a record. Without this the
        // verdict is thrown away: in shadow that is the data the rollout
        // exists to collect, and in `on` mode it is an admin looking at a
        // handover that silently never started, with no reasoning on the
        // record to say why.
        if (trace) {
          await matchRepository.update(existingId, {
            adjudication: adjudicationRecordFrom(trace),
            handoverHeld: held,
          });
        }

        created.push({ matchId: existingId, candidate });
        continue;
      }

      const newMatchId = await matchRepository.create(
        matchRecordFrom(lostItemId, foundItemId, candidate, trace, held),
      );
      log.info(`[AUTO-MATCH] Match record ${newMatchId} created at ${candidate.score}%`);
      created.push({ matchId: newMatchId, candidate });
    }

    // 2. Move both items on the single best match.
    const winner = matches[0];
    const bestMatchId = winner.item.id;
    const highestScore = winner.score;

    await Promise.all([
      itemRepository.update(itemId, {
        status: 'Matched',
        matchScore: highestScore,
        matchedItemId: bestMatchId,
        bestCandidateScore: FieldValue.delete(),
      }),
      itemRepository.update(bestMatchId, {
        status: 'Matched',
        matchScore: highestScore,
        matchedItemId: itemId,
        bestCandidateScore: FieldValue.delete(),
      }),
    ]);

    // 3. One handover, for the winner only, after the loop. Initiating inside
    //    the loop opened N sessions and sent 2N emails for a single report.
    const winning = created.find((entry) => entry.candidate.item.id === bestMatchId);

    // The agent found evidence it could not resolve, so the pair waits for an
    // admin rather than emailing two people a collection code. The match record
    // and its reasoning are already written, which is what the admin reviews.
    if (winning && awaitingReview) {
      log.info(
        `[AUTO-MATCH] Handover held for review on match ${winning.matchId}: adjudication returned ${adjudication?.verdict.decision} at ${adjudication?.verdict.confidence}% confidence`,
      );
    }

    if (winning && !awaitingReview) {
      const lostItemId = itemType === 'Lost' ? itemId : bestMatchId;
      const foundItemId = itemType === 'Found' ? itemId : bestMatchId;

      try {
        const result = await initiateHandover(winning.matchId, lostItemId, foundItemId);

        if (!result.success) {
          log.info(`[AUTO-MATCH] Handover not started: ${result.message}`);
        }
      } catch (handoverError) {
        log.error('[AUTO-MATCH] Handover error:', handoverError);
      }
    }

    log.info(`[AUTO-MATCH] Complete: ${matches.length} match(es), best ${highestScore}%`);

    return { bestMatchId, highestScore, awaitingReview };
  } catch (error) {
    log.error(`[AUTO-MATCH] Error during matching for item ${itemId}:`, error);
    throw error;
  }
}
