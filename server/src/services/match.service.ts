/**
 * Match business logic: searching, claiming, and the admin decision.
 *
 * The admin decision is the delicate one. It moves two items, one match
 * record, a handover and possibly a credit penalty, and several of its rules
 * exist because an earlier version got one of those wrong.
 */

import { FieldValue } from 'firebase-admin/firestore';
import {
  ItemRepository,
  itemRepository,
  type StoredItem,
} from '../repositories/item.repository.js';
import {
  MatchRepository,
  matchRepository,
  type StoredMatch,
} from '../repositories/match.repository.js';
import { findMatchesForFoundItem, findMatchesForLostItem } from './matching.service.js';
import { penalizeFalseClaim } from './credits.service.js';
import { sendMatchNotification } from './email.service.js';
import { initiateHandover } from './handover.service.js';
import { recordAdminAction } from './audit.service.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import type { AuthUser } from '../middleware/auth.middleware.js';
import type { MatchClaimBody, MatchSearchBody, MatchVerifyBody } from '../schemas/index.js';

/** The score a manually verified match records, having been decided by a human. */
const MANUAL_MATCH_SCORE = 100;

/** Placeholder score on the claim notification email. */
const CLAIM_NOTIFICATION_SCORE = 85;

export interface VerifyOutcome {
  success: true;
  message: string;
  penalised?: boolean;
}

function isOwnerOrAdmin(user: AuthUser | undefined, ownerId: string | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return Boolean(ownerId) && user.uid === ownerId;
}

export class MatchService {
  constructor(
    private readonly matches: MatchRepository = matchRepository,
    private readonly items: ItemRepository = itemRepository,
  ) {}

  search(body: MatchSearchBody) {
    const searchParams = {
      name: body.name,
      description: body.description || '',
      tags: body.tags || [],
      color: body.color,
      location: body.location,
      category: body.category,
      coordinates: body.coordinates,
      date: body.date ? new Date(body.date) : new Date(),
      imageBase64: body.imageBase64,
    };

    return body.type === 'Lost'
      ? findMatchesForLostItem(searchParams)
      : findMatchesForFoundItem(searchParams);
  }

  listActive(): Promise<StoredMatch[]> {
    return this.matches.listActive();
  }

  /**
   * Live matches and archived ones together, for the dashboard graphs, each
   * flagged with which collection it came from.
   */
  async listAll(): Promise<StoredMatch[]> {
    const [active, history] = await Promise.all([
      this.matches.listActive(),
      this.matches.listHistory(),
    ]);

    return [
      ...active.map((match) => ({ ...match, isActive: true })),
      ...history.map((match) => ({ ...match, isActive: false })),
    ];
  }

  listForItem(itemId: string): Promise<StoredMatch[]> {
    return this.matches.listForItem(itemId);
  }

  /**
   * A user claims a found item is theirs.
   *
   * The claim is always made by the caller, never on behalf of a body-supplied
   * user id (defect SEC-01).
   */
  async claim(body: MatchClaimBody, user: AuthUser): Promise<void> {
    const { itemId, lostItemId } = body;

    const item = await this.items.findById(itemId);

    if (!item) throw new AppError('Item not found', 404);

    await this.items.update(itemId, {
      status: 'Matched',
      claimedBy: user.uid,
      claimedAt: FieldValue.serverTimestamp(),
    });

    // If there is a corresponding lost item, update it too. It has to be the
    // caller's own report: otherwise any active user could flip a stranger's
    // lost item to Matched and point it at an unrelated found item.
    if (lostItemId) {
      const lostItem = await this.items.findById(lostItemId);

      if (!lostItem) throw new AppError('Lost item not found', 404);

      if (!isOwnerOrAdmin(user, lostItem.reportedBy)) {
        throw new AppError('You can only claim against your own lost report', 403);
      }

      await this.items.update(lostItemId, { status: 'Matched', matchedItemId: itemId });
    }

    if (user.email) {
      await sendMatchNotification(user.email, item.name, CLAIM_NOTIFICATION_SCORE, item.location);
    }
  }

  /**
   * The admin decision on a claim or a proposal.
   *
   * The verifying admin is whoever holds the token, not whoever the body
   * names. Trusting the body also meant a missing adminId wrote `undefined`
   * into Firestore and threw, after the handover emails had already gone out.
   */
  async verify(body: MatchVerifyBody, adminId: string): Promise<VerifyOutcome> {
    const { itemId, matchId: requestedMatchId, claimUserId, isValid } = body;

    const item = await this.items.findById(itemId);

    if (!item) throw new AppError('Item not found', 404);

    const pair = await this.resolvePair(itemId, item, requestedMatchId);

    return isValid
      ? this.acceptMatch(itemId, pair, body, adminId, requestedMatchId)
      : this.rejectMatch(itemId, item, pair, body, adminId, requestedMatchId);
  }

  /**
   * Work out which two items the decision is about.
   *
   * The pair is resolved before the decision branches. A rejection has to reset
   * both halves, not just the named one: verification moves both to Matched, so
   * resetting one left the counterpart stuck at Matched forever, and the
   * retrieval stage only ever looks at Pending items.
   */
  private async resolvePair(
    itemId: string,
    item: StoredItem,
    requestedMatchId: string | undefined,
  ): Promise<{ lostItemId?: string; foundItemId?: string }> {
    if (!requestedMatchId) {
      return {
        lostItemId: item.type === 'Lost' ? itemId : item.matchedItemId,
        foundItemId: item.type === 'Found' ? itemId : item.matchedItemId,
      };
    }

    const match = await this.matches.findById(requestedMatchId);

    if (!match) throw new AppError('Match not found', 404);

    if (!match.lostItemId || !match.foundItemId) {
      throw new AppError('Match record is missing an item ID', 400);
    }

    // The named item has to be half of the pair being decided on, otherwise the
    // decision is about one match and the penalty and the status writes land on
    // an unrelated item.
    if (itemId !== match.lostItemId && itemId !== match.foundItemId) {
      throw new AppError('Item is not part of this match', 400);
    }

    return { lostItemId: match.lostItemId, foundItemId: match.foundItemId };
  }

  private async acceptMatch(
    itemId: string,
    pair: { lostItemId?: string; foundItemId?: string },
    body: MatchVerifyBody,
    adminId: string,
    requestedMatchId: string | undefined,
  ): Promise<VerifyOutcome> {
    const { lostItemId, foundItemId } = pair;

    if (!lostItemId || !foundItemId) {
      throw new AppError('Cannot initiate handover: missing linked item ID', 400);
    }

    // Both halves must still exist before anything is sent. Only `itemId` was
    // ever proved to exist, so a stale match record naming a deleted item used
    // to fail on the status write, which runs after the handover emails have
    // gone out and cannot be taken back.
    const [lostExists, foundExists] = await Promise.all([
      this.items.exists(lostItemId),
      this.items.exists(foundItemId),
    ]);

    if (!lostExists || !foundExists) {
      throw new AppError('One of the matched items no longer exists', 404);
    }

    // Find or create the match record. Both ids are real by this point, so the
    // lookup uses them directly. It used to fall back to the literal string
    // 'unknown', which then went into a written match document and from there
    // into initiateHandover and completeHandover.
    const existing = await this.matches.findByPair(lostItemId, foundItemId);

    let matchId = existing?.id ?? '';
    let createdMatchId = '';

    if (!matchId) {
      matchId = await this.matches.create({
        lostItemId,
        foundItemId,
        matchScore: MANUAL_MATCH_SCORE,
        status: 'matched',
      });
      createdMatchId = matchId;
    }

    const result = await initiateHandover(matchId, lostItemId, foundItemId, {
      actorId: adminId,
      overrideCriteria: body.overrideCriteria,
      overrideReason: body.overrideReason,
    });

    if (!result.success) {
      // A refusal is a routine outcome, so a match record this request invented
      // must not survive it.
      if (createdMatchId) {
        await this.matches.delete(createdMatchId);
      }

      // `criteriaFailure` reaches the admin screen, which offers the override
      // only when it knows which check refused.
      throw new AppError(result.message, 400, { criteriaFailure: result.criteriaFailure });
    }

    // Advance both items out of Pending. The handover is now in flight, so
    // neither item is available any more; this used to write only the
    // verification fields, leaving both items listed as available and still
    // eligible as matching candidates for other reports.
    //
    // `itemId` is always one half of the pair, so the verification fields ride
    // along on that half's update rather than as a second write to the same
    // document.
    const verification = {
      verificationConfidence: MANUAL_MATCH_SCORE,
      verifiedBy: adminId,
      verifiedAt: FieldValue.serverTimestamp(),
    };
    const verifiedLost = itemId === lostItemId;

    await Promise.all([
      this.items.update(lostItemId, {
        status: 'Matched',
        matchedItemId: foundItemId,
        ...(verifiedLost ? verification : {}),
      }),
      this.items.update(foundItemId, {
        status: 'Matched',
        matchedItemId: lostItemId,
        ...(verifiedLost ? {} : verification),
      }),
    ]);

    await recordAdminAction({
      action: 'match_verified',
      targetId: itemId,
      actorId: adminId,
      reason: body.overrideCriteria ? body.overrideReason : undefined,
      details: {
        matchId,
        lostItemId,
        foundItemId,
        overrideCriteria: Boolean(body.overrideCriteria),
        requestedMatchId: requestedMatchId ?? null,
      },
    });

    return {
      success: true,
      message: 'Match verified. Handover process initiated and emails sent.',
    };
  }

  private async rejectMatch(
    itemId: string,
    item: StoredItem,
    pair: { lostItemId?: string; foundItemId?: string },
    body: MatchVerifyBody,
    adminId: string,
    requestedMatchId: string | undefined,
  ): Promise<VerifyOutcome> {
    const pairIds = [...new Set([itemId, pair.lostItemId, pair.foundItemId].filter(Boolean))];
    const pairItems = (
      await Promise.all(pairIds.map((id) => this.items.findById(id as string)))
    ).filter((found): found is StoredItem => found !== null);

    // A penalty is for a person who claimed an item that was not theirs. The
    // admin match list also shows pipeline proposals that nobody ever claimed,
    // and dismissing one of those must not charge the reporter of the lost item
    // 30 credits for a claim they never made.
    //
    // `claimedBy` is written by the claim endpoint onto the found item, which is
    // not necessarily the item this request named, so the whole pair is checked
    // rather than just that one document.
    const claimant = pairItems.map((found) => found.claimedBy).find(Boolean);
    const penalise = Boolean(claimant) && claimant === body.claimUserId;

    if (penalise) {
      await penalizeFalseClaim(body.claimUserId, itemId);
    }

    // Reset both halves of the pair, not only the named item: verification moves
    // both to Matched, so resetting one left the counterpart stranded there and
    // invisible to every future matching run.
    await this.items.updateMany(
      pairItems.map((found) => found.id),
      {
        status: 'Pending' as const,
        matchedItemId: FieldValue.delete(),
        claimedBy: FieldValue.delete(),
        claimedAt: FieldValue.delete(),
      },
    );

    // The proposal was refused, so it stops being an open match. Marked rather
    // than deleted: the trail of what was rejected is the point.
    if (requestedMatchId) {
      await this.matches.update(requestedMatchId, { status: 'rejected' });
    }

    await recordAdminAction({
      action: 'match_rejected',
      targetId: itemId,
      actorId: adminId,
      details: {
        claimUserId: body.claimUserId,
        itemType: item.type,
        penalised: penalise,
        matchId: requestedMatchId ?? null,
      },
    });

    return {
      success: true,
      penalised: penalise,
      message: penalise
        ? 'Claim rejected. Penalty applied to user.'
        : 'Match rejected. No claim was on record, so no penalty was applied.',
    };
  }

  /**
   * The matches already found for a user's open lost reports.
   *
   * This used to re-run the whole pipeline for every one of the user's lost
   * items on every request: one LLM call per candidate per item, on a route a
   * page could poll (defect PERF-04). Matching runs when an item is created or
   * approved and persists what it finds, so this reads those records instead.
   * The manual `POST /api/items/:id/rematch` is what re-runs the pipeline.
   */
  async listForUser(userId: string) {
    const lostItems = await this.items.listByReporterAndType(userId, 'Lost');
    const openItems = lostItems.filter((item) => item.status === 'Pending');

    if (openItems.length === 0) return [];

    const perItem = await Promise.all(
      openItems.map(async (item) => ({
        lostItem: item,
        // Rejected proposals are kept as a record of what was refused, not
        // offered back as candidates.
        records: (await this.matches.listForItem(item.id)).filter(
          (record) => record.status !== 'rejected',
        ),
      })),
    );

    // One read per counterpart, de-duplicated: two of the user's reports can
    // legitimately match the same found item.
    const counterpartIds = [
      ...new Set(
        perItem.flatMap(({ lostItem, records }) =>
          records.map((record) =>
            record.lostItemId === lostItem.id ? record.foundItemId : record.lostItemId,
          ),
        ),
      ),
    ].filter((id): id is string => Boolean(id));

    const counterparts = new Map(
      (await Promise.all(counterpartIds.map((id) => this.items.findById(id))))
        .filter((item): item is StoredItem => item !== null)
        .map((item) => [item.id, item]),
    );

    return perItem.map(({ lostItem, records }) => ({
      lostItem,
      matches: records
        .map((record) => {
          const counterpartId =
            record.lostItemId === lostItem.id ? record.foundItemId : record.lostItemId;
          const counterpart = counterpartId ? counterparts.get(counterpartId) : undefined;

          if (!counterpart) return null;

          return {
            itemId: counterpart.id,
            item: counterpart,
            score: record.matchScore ?? 0,
            breakdown: {
              tagScore: record.tagScore ?? 0,
              descriptionScore: record.descriptionScore ?? 0,
              colorScore: record.colorScore ?? 0,
              locationScore: record.locationScore ?? 0,
              timeScore: record.timeScore ?? 0,
              imageScore: record.imageScore ?? 0,
            },
          };
        })
        .filter((match): match is NonNullable<typeof match> => match !== null)
        .sort((a, b) => b.score - a.score),
    }));
  }
}

export const matchService = new MatchService();
