/**
 * Matches API Routes - Find and manage item matches
 */

import { Router, Request, Response } from 'express';
import { findMatchesForLostItem, findMatchesForFoundItem } from '../services/matching.js';
import { toDate } from '../services/matching/matching.pipeline.js';
import { penalizeFalseClaim } from '../services/credits.js';
import { sendMatchNotification, sendClaimConfirmation } from '../services/email.js';
import { collections } from '../utils/firebase-admin.js';
import { Item } from '../types/index.js';
import { FieldValue } from 'firebase-admin/firestore';
import { initiateHandover } from '../services/handover.service.js';
import { recordAdminAction } from '../services/audit.service.js';
import {
  assertOwnerOrAdmin,
  AuthRequest,
  asyncHandler,
  authMiddleware,
  requireActiveUser,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
} from '../middleware/index.js';
import {
  itemIdParamsSchema,
  matchClaimSchema,
  matchSearchSchema,
  matchVerifySchema,
  userIdParamsSchema,
} from '../schemas/index.js';

const router = Router();

/**
 * POST /api/matches/search
 * Search for matches for an item
 */
router.post(
  '/search',
  authMiddleware,
  requireActiveUser,
  validate(matchSearchSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      type,
      name,
      description,
      tags,
      color,
      location,
      category,
      coordinates,
      date,
      imageBase64,
    } = req.body;

    const searchParams = {
      name,
      description: description || '',
      tags: tags || [],
      color,
      location,
      category,
      coordinates,
      date: date ? new Date(date) : new Date(),
      imageBase64,
    };

    const matches =
      type === 'Lost'
        ? await findMatchesForLostItem(searchParams)
        : await findMatchesForFoundItem(searchParams);

    return res.json({ matches });
  }),
);

/**
 * POST /api/matches/claim
 * Claim a match (user claims a found item is theirs)
 */
router.post(
  '/claim',
  authMiddleware,
  requireActiveUser,
  validate(matchClaimSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // A claim is always made by the caller, never on behalf of a body-supplied
    // user id (SEC-01).
    const userId = req.user!.uid;
    const userEmail = req.user!.email;
    const { itemId, lostItemId } = req.body;

    // Get the found item
    const itemDoc = await collections.items.doc(itemId).get();
    if (!itemDoc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemDoc.data()!;

    // Update item status to "Under Verification"
    await collections.items.doc(itemId).update({
      status: 'Matched',
      claimedBy: userId,
      claimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // If there's a corresponding lost item, update it too. It has to be the
    // caller's own report: otherwise any active user could flip a stranger's
    // lost item to Matched and point it at an unrelated found item.
    if (lostItemId) {
      const lostItemDoc = await collections.items.doc(lostItemId).get();
      if (!lostItemDoc.exists) {
        return res.status(404).json({ error: 'Lost item not found' });
      }

      const lostItem = lostItemDoc.data() as Item;
      if (!assertOwnerOrAdmin(req.user, lostItem.reportedBy)) {
        return res.status(403).json({ error: 'You can only claim against your own lost report' });
      }

      await collections.items.doc(lostItemId).update({
        status: 'Matched',
        matchedItemId: itemId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Notify via email
    if (userEmail) {
      await sendMatchNotification(
        userEmail,
        item.name,
        85, // Placeholder match score
        item.location,
      );
    }

    return res.json({
      success: true,
      message: 'Claim submitted. Please visit the collection point with ID for verification.',
    });
  }),
);

/**
 * POST /api/matches/verify
 * Admin verifies a claim (marks as successful or false)
 */

router.post(
  '/verify',
  authMiddleware,
  requireAdmin,
  validate(matchVerifySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // The verifying admin is whoever holds the token, not whoever the body
    // names. Trusting the body also meant a missing adminId wrote `undefined`
    // into Firestore and threw, after the handover emails had already gone out.
    const adminId = req.user!.uid;
    const {
      itemId,
      matchId: requestedMatchId,
      claimUserId,
      isValid,
      overrideCriteria,
      overrideReason,
    } = req.body;

    const itemDoc = await collections.items.doc(itemId).get();
    if (!itemDoc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemDoc.data()!;

    // The pair is resolved before the decision branches. A rejection has to
    // reset both halves, not just the named one: verification moves both to
    // Matched, so resetting one left the counterpart stuck at Matched forever,
    // and the retrieval stage only ever looks at Pending items.
    let existingMatch: { lostItemId: string; foundItemId: string } | null = null;

    if (requestedMatchId) {
      const matchDoc = await collections.matches.doc(requestedMatchId).get();

      if (!matchDoc.exists) {
        return res.status(404).json({ error: 'Match not found' });
      }

      const data = matchDoc.data() as { lostItemId?: string; foundItemId?: string };

      if (!data.lostItemId || !data.foundItemId) {
        return res.status(400).json({ error: 'Match record is missing an item ID' });
      }

      // The named item has to be half of the pair being decided on, otherwise
      // the decision is about one match and the penalty and the status writes
      // land on an unrelated item.
      if (itemId !== data.lostItemId && itemId !== data.foundItemId) {
        return res.status(400).json({ error: 'Item is not part of this match' });
      }

      existingMatch = { lostItemId: data.lostItemId, foundItemId: data.foundItemId };
    }

    const lostItemId = existingMatch
      ? existingMatch.lostItemId
      : item.type === 'Lost'
        ? itemId
        : item.matchedItemId;
    const foundItemId = existingMatch
      ? existingMatch.foundItemId
      : item.type === 'Found'
        ? itemId
        : item.matchedItemId;

    if (isValid) {
      // VERIFIED MATCH - Initiate Handover

      if (!lostItemId || !foundItemId) {
        return res.status(400).json({ error: 'Cannot initiate handover: missing linked item ID' });
      }

      // Both halves must still exist before anything is sent. Only `itemId`
      // was ever proved to exist, so a stale match record naming a deleted
      // item used to fail on the status write, which runs after the handover
      // emails have gone out and cannot be taken back.
      const [lostSnapshot, foundSnapshot] = await Promise.all([
        collections.items.doc(lostItemId).get(),
        collections.items.doc(foundItemId).get(),
      ]);

      if (!lostSnapshot.exists || !foundSnapshot.exists) {
        return res.status(404).json({ error: 'One of the matched items no longer exists' });
      }

      // 2. Find or create the match record. Both ids are real by this point,
      //    so the lookup uses them directly. It used to fall back to the
      //    literal string 'unknown', which then went into a written match
      //    document and from there into initiateHandover and completeHandover.
      let matchId = '';
      let createdMatchId = '';

      const matchQuery = await collections.matches
        .where('lostItemId', '==', lostItemId)
        .where('foundItemId', '==', foundItemId)
        .limit(1)
        .get();

      if (!matchQuery.empty) {
        matchId = matchQuery.docs[0].id;
      }

      // If still no match ID (e.g. manual claim without match record), create one
      if (!matchId) {
        const newMatch = await collections.matches.add({
          lostItemId,
          foundItemId,
          matchScore: 100, // Verified manually
          status: 'matched',
          createdAt: FieldValue.serverTimestamp(),
        });
        matchId = newMatch.id;
        createdMatchId = newMatch.id;
      }

      // 3. Initiate Handover
      const result = await initiateHandover(matchId, lostItemId, foundItemId, {
        actorId: adminId,
        overrideCriteria,
        overrideReason,
      });

      if (!result.success) {
        // A refusal is now a routine outcome, so a match record this request
        // invented must not survive it.
        if (createdMatchId) {
          await collections.matches.doc(createdMatchId).delete();
        }

        return res
          .status(400)
          .json({ error: result.message, criteriaFailure: result.criteriaFailure });
      }

      // 4. Advance both items out of Pending. The handover is now in flight,
      //    so neither item is available any more; this used to write only the
      //    verification fields, leaving both items listed as available and
      //    still eligible as matching candidates for other reports.
      //
      // `itemId` is always one half of the pair, so the verification fields
      // ride along on that half's update rather than as a second write to the
      // same document.
      const now = FieldValue.serverTimestamp();
      const verification = {
        verificationConfidence: 100,
        verifiedBy: adminId,
        verifiedAt: now,
      };
      const verifiedLost = itemId === lostItemId;

      await Promise.all([
        collections.items.doc(lostItemId).update({
          status: 'Matched',
          matchedItemId: foundItemId,
          updatedAt: now,
          ...(verifiedLost ? verification : {}),
        }),
        collections.items.doc(foundItemId).update({
          status: 'Matched',
          matchedItemId: lostItemId,
          updatedAt: now,
          ...(verifiedLost ? {} : verification),
        }),
      ]);

      await recordAdminAction({
        action: 'match_verified',
        targetId: itemId,
        actorId: adminId,
        reason: overrideCriteria ? overrideReason : undefined,
        details: { matchId, lostItemId, foundItemId, overrideCriteria: Boolean(overrideCriteria) },
      });

      return res.json({
        success: true,
        message: 'Match verified. Handover process initiated and emails sent.',
      });
    } else {
      const pairIds = [...new Set([itemId, lostItemId, foundItemId].filter(Boolean))] as string[];
      const pairDocs = (
        await Promise.all(pairIds.map((id) => collections.items.doc(id).get()))
      ).filter((doc) => doc.exists);

      // A penalty is for a person who claimed an item that was not theirs. The
      // admin match list also shows pipeline proposals that nobody ever
      // claimed, and dismissing one of those must not charge the reporter of
      // the lost item 30 credits for a claim they never made.
      //
      // `claimedBy` is written by POST /api/matches/claim onto the found item,
      // which is not necessarily the item this request named, so the whole
      // pair is checked rather than just that one document.
      const claimant = pairDocs
        .map((doc) => doc.data()?.claimedBy as string | undefined)
        .find(Boolean);
      const penalise = Boolean(claimant) && claimant === claimUserId;

      if (penalise) {
        await penalizeFalseClaim(claimUserId, itemId);
      }

      // Reset both halves of the pair, not only the named item: verification
      // moves both to Matched, so resetting one left the counterpart stranded
      // there and invisible to every future matching run.
      const now = FieldValue.serverTimestamp();
      const reset = {
        status: 'Pending' as const,
        matchedItemId: FieldValue.delete(),
        claimedBy: FieldValue.delete(),
        claimedAt: FieldValue.delete(),
        updatedAt: now,
      };

      await Promise.all(pairDocs.map((doc) => doc.ref.update(reset)));

      // The proposal was refused, so it stops being an open match. Marked
      // rather than deleted: the trail of what was rejected is the point.
      if (requestedMatchId) {
        await collections.matches.doc(requestedMatchId).update({
          status: 'rejected',
          updatedAt: now,
        });
      }

      await recordAdminAction({
        action: 'match_rejected',
        targetId: itemId,
        actorId: adminId,
        details: {
          claimUserId,
          itemType: item.type,
          penalised: penalise,
          matchId: requestedMatchId ?? null,
        },
      });

      return res.json({
        success: true,
        penalised: penalise,
        message: penalise
          ? 'Claim rejected. Penalty applied to user.'
          : 'Match rejected. No claim was on record, so no penalty was applied.',
      });
    }
  }),
);

/**
 * GET /api/matches
 * Get all match records from matches collection
 */
router.get(
  '/',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const snapshot = await collections.matches.orderBy('createdAt', 'desc').get();

    const matches = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({ matches });
  }),
);

/**
 * GET /api/matches/all
 * Get all matches including historical (claimed) matches for dashboard graphs
 */
router.get(
  '/all',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    // Get active matches
    const activeSnapshot = await collections.matches.orderBy('createdAt', 'desc').get();

    // Get historical matches
    const historySnapshot = await collections.matchHistory.orderBy('createdAt', 'desc').get();

    const activeMatches = activeSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      isActive: true,
    }));

    const historicalMatches = historySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      isActive: false,
    }));

    // Combine and return all matches
    const allMatches = [...activeMatches, ...historicalMatches];

    return res.json({ matches: allMatches });
  }),
);

/**
 * GET /api/matches/item/:itemId
 * Get all match records for a specific item
 */
router.get(
  '/item/:itemId',
  authMiddleware,
  requireAdmin,
  validateParams(itemIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { itemId } = req.params;

    // Query for matches where this item is either the lost or found item
    const lostMatches = await collections.matches.where('lostItemId', '==', itemId).get();

    const foundMatches = await collections.matches.where('foundItemId', '==', itemId).get();

    const matches = [
      ...lostMatches.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      ...foundMatches.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    ];

    return res.json({ matches });
  }),
);

/**
 * GET /api/matches/user/:userId
 * Get all matches for a user's items
 */
router.get(
  '/user/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    // Get user's lost items
    const lostSnapshot = await collections.items
      .where('reportedBy', '==', userId)
      .where('type', '==', 'Lost')
      .get();

    // Get matches for each
    const allMatches = [];

    // Only items still looking for a match are worth scoring. Running the
    // pipeline for every lost item the user ever reported turned one request
    // into dozens of sequential LLM waves.
    const openItems = lostSnapshot.docs.filter((doc) => doc.data().status === 'Pending');

    for (const doc of openItems) {
      const item = doc.data();
      const date = toDate(item.date);

      // A legacy item with no date used to throw on `item.date.toDate()` and
      // fail the whole request. It cannot be time-scored, so it is skipped.
      if (!date) {
        allMatches.push({ lostItem: { id: doc.id, ...item }, matches: [] });
        continue;
      }

      const matches = await findMatchesForLostItem({
        name: item.name,
        description: item.description,
        tags: item.tags,
        color: item.color,
        location: item.location,
        coordinates: item.coordinates,
        cloudinaryUrls: item.cloudinaryUrls,
        date,
      });

      allMatches.push({
        lostItem: { id: doc.id, ...item },
        matches,
      });
    }

    return res.json({ results: allMatches });
  }),
);

export default router;
