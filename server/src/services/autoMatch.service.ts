/**
 * Automatic matching on item creation.
 *
 * This is one of two entry points onto `MatchingService`; the other is manual
 * search in `matching.ts`. Scoring lives entirely in the pipeline. What is left
 * here is the part specific to the create path: persisting match records,
 * moving item status, and starting exactly one handover.
 */

import { collections } from '../utils/firebase-admin.js';
import { ItemType } from '../types/index.js';
import { FieldValue } from 'firebase-admin/firestore';
import { MATCH_CONFIG } from '../utils/scoring.js';
import { initiateHandover } from './handover.service.js';
import { createLogger } from '../utils/logger.js';
import { MatchingService } from './matching/matching.pipeline.js';
import { MatchSubject, ScoredCandidate } from './matching/matching.types.js';

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
}

export interface AutoMatchResult {
  bestMatchId?: string;
  highestScore: number;
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
    collections.matches
      .where('lostItemId', '==', lostItemId)
      .where('foundItemId', '==', foundItemId)
      .limit(1)
      .get(),
    collections.matches
      .where('lostItemId', '==', foundItemId)
      .where('foundItemId', '==', lostItemId)
      .limit(1)
      .get(),
  ]);

  if (!forward.empty) return forward.docs[0].id;
  if (!reverse.empty) return reverse.docs[0].id;

  return null;
}

function matchRecordFrom(
  lostItemId: string,
  foundItemId: string,
  candidate: ScoredCandidate,
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
    };

    const pipeline = new MatchingService();
    const { matches, best } = await pipeline.run(subject, itemType);

    if (matches.length === 0) {
      // A best score below the threshold is a candidate, not a match. Writing
      // it to `matchScore` made the UI show a match percentage for an item
      // that has none.
      if (best) {
        await collections.items.doc(itemId).update({ bestCandidateScore: best.score });
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

      if (existingId) {
        created.push({ matchId: existingId, candidate });
        continue;
      }

      const ref = await collections.matches.add(
        matchRecordFrom(lostItemId, foundItemId, candidate),
      );
      log.info(`[AUTO-MATCH] Match record ${ref.id} created at ${candidate.score}%`);
      created.push({ matchId: ref.id, candidate });
    }

    // 2. Move both items on the single best match.
    const winner = matches[0];
    const bestMatchId = winner.item.id;
    const highestScore = winner.score;

    await Promise.all([
      collections.items.doc(itemId).update({
        status: 'Matched',
        matchScore: highestScore,
        matchedItemId: bestMatchId,
        bestCandidateScore: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      collections.items.doc(bestMatchId).update({
        status: 'Matched',
        matchScore: highestScore,
        matchedItemId: itemId,
        bestCandidateScore: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    // 3. One handover, for the winner only, after the loop. Initiating inside
    //    the loop opened N sessions and sent 2N emails for a single report.
    const winning = created.find((entry) => entry.candidate.item.id === bestMatchId);

    if (winning) {
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

    return { bestMatchId, highestScore };
  } catch (error) {
    log.error(`[AUTO-MATCH] Error during matching for item ${itemId}:`, error);
    throw error;
  }
}
