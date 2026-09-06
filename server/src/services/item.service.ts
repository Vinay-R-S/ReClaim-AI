/**
 * Item business logic.
 *
 * Everything the routes used to decide inline: who may see an unreviewed
 * report, what an admin may change that an owner may not, when a matching run
 * is worth starting, and what happens to the images and the user's counts when
 * an item goes away.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  ItemRepository,
  itemRepository,
  type StoredItem,
} from '../repositories/item.repository.js';
import { deleteImage, isCloudinaryConfigured, uploadMultipleImages } from './cloudinary.service.js';
import { recordAdminAction } from './audit.service.js';
import { triggerAutoMatching } from './autoMatch.service.js';
import { updateUserItemCounts } from './userStats.service.js';
import { createItemEmbeddingString } from '../utils/embeddings.js';
import { stripUndefined } from '../utils/firestore.js';
import { createLogger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import type { AuthUser } from '../middleware/auth.middleware.js';
import type { ItemListQuery, ItemModerateBody, ItemUpdateBody } from '../schemas/index.js';
import type { Item, ItemInput, ItemStatus, ItemType, ModerationStatus } from '../types/index.js';

const log = createLogger('item.service');

/** How long a matching run holds its claim before another may take it over. */
const MATCHING_RUN_TTL_MS = 5 * 60 * 1000;

/** What a create or a moderation decision reports about the matching run. */
export type MatchingOutcome = 'pending' | 'awaiting_review' | 'not_started';

/**
 * Whether an item may be shown to someone who is not an admin.
 *
 * Items created before moderation existed carry no field and read as approved:
 * the alternative is that every legacy item vanishes from the browse list the
 * moment this deploys, and stays gone until the migration runs.
 */
export function isPubliclyVisible(item: { moderation?: ModerationStatus }): boolean {
  return item.moderation === undefined || item.moderation === 'approved';
}

function isOwnerOrAdmin(user: AuthUser | undefined, ownerId: string | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return Boolean(ownerId) && user.uid === ownerId;
}

export class ItemService {
  constructor(private readonly items: ItemRepository = itemRepository) {}

  /**
   * The browse list.
   *
   * Without an explicit moderation filter, visibility is decided in memory: a
   * legacy item has no `moderation` field at all, and an equality filter would
   * drop every one of them. An owner sees their own unreviewed reports;
   * everyone else sees approved items only.
   */
  async list(
    filters: ItemListQuery,
    user: AuthUser | undefined,
  ): Promise<{ items: StoredItem[]; nextCursor: string | null }> {
    const isAdmin = user?.role === 'admin';

    // The browse list is public, but filtering by owner is not: without this,
    // `?reportedBy=<victim-uid>` would enumerate another user's reports and
    // walk straight around the ownership guard on GET /user/:userId.
    if (filters.reportedBy && !isOwnerOrAdmin(user, filters.reportedBy)) {
      throw new AppError('You can only list your own reports', 403);
    }

    const { items, sortedByQuery, nextCursor } = await this.items.list({
      type: filters.type,
      status: filters.status,
      // A moderation filter is an admin tool. A non-admin asking for one gets
      // the ordinary visibility rules instead of a filtered view.
      moderation: isAdmin ? filters.moderation : undefined,
      reportedBy: filters.reportedBy,
      limit: filters.limit,
      cursor: filters.cursor,
    });

    if (!sortedByQuery) {
      return {
        items: items
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
          .slice(0, filters.limit),
        nextCursor: null,
      };
    }

    const ownList = Boolean(filters.reportedBy) && isOwnerOrAdmin(user, filters.reportedBy);

    // Visibility is applied after the page is taken, so a page can come back
    // shorter than the limit while more pages remain: `nextCursor` is what says
    // whether to ask again, not the length of what arrived.
    return {
      items: isAdmin || ownList ? items : items.filter(isPubliclyVisible),
      nextCursor,
    };
  }

  /**
   * One item.
   *
   * The same gate the list applies. Without it an unreviewed or rejected report
   * stayed fully readable, reporter email and collection point included, to
   * anyone holding its id. The reporter and admins still see their own, which
   * is what the post-report poll needs.
   */
  async getById(id: string, user: AuthUser | undefined): Promise<StoredItem> {
    const item = await this.items.findById(id);

    if (!item) throw new AppError('Item not found', 404);

    if (!isPubliclyVisible(item) && !isOwnerOrAdmin(user, item.reportedBy)) {
      throw new AppError('Item not found', 404);
    }

    return item;
  }

  listByReporter(userId: string): Promise<StoredItem[]> {
    return this.items.listByReporter(userId);
  }

  /**
   * Create a reported item.
   *
   * Matching deliberately does not run inside the request: it calls an LLM and
   * a vision API per candidate, so awaiting it made submission as slow and as
   * fragile as the slowest provider, and a matching failure returned 500 for an
   * item that had already been persisted. It also only runs for an item that
   * has cleared review, because matching an unreviewed report can initiate a
   * handover and email a stranger a collection code.
   */
  async create(
    input: ItemInput,
    images: string[] | undefined,
    user: AuthUser,
  ): Promise<{ item: StoredItem; matching: MatchingOutcome }> {
    const cloudinaryUrls = await this.uploadImages(images);

    // An admin creating an item is the review: the add-item and CCTV register
    // flows would otherwise queue their own work for themselves.
    const moderation: ModerationStatus = user.role === 'admin' ? 'approved' : 'pending';

    // Collection details for Found items. The form sends `collectionLocation`
    // and every consumer reads `collectionPoint`, which is why the handover
    // email showed the found-at location and the admin screen showed nothing.
    // One canonical name is written here, whichever alias arrived.
    const collectionPoint = input.collectionPoint || input.collectionLocation;

    const document = stripUndefined({
      name: input.name,
      description: input.description,
      type: input.type,
      status: 'Pending' as const,
      moderation,
      location: input.location,
      date: Timestamp.fromDate(new Date(input.date)),
      tags: input.tags || [],
      color: input.color || '',
      category: input.category || 'Other',
      cloudinaryUrls,
      reportedBy: user.uid,
      reportedByEmail: input.reporterEmail,
      collectionPoint: collectionPoint || undefined,
      collectionCoordinates: input.collectionCoordinates,
      coordinates: input.coordinates,
    });

    this.logSemanticText(input);

    const created = await this.items.create(document);

    log.info(`[ITEM-CREATE] Item created: ${created.id}, type: ${input.type}`);

    await this.adjustUserCounts(user.uid, input.type, 'increment');

    if (moderation !== 'approved') {
      return { item: created, matching: 'awaiting_review' };
    }

    void this.runMatchingInBackground(created.id, input, cloudinaryUrls);

    return { item: created, matching: 'pending' };
  }

  /**
   * Approve or reject a reported item.
   *
   * Approval is what makes an item publicly visible and eligible for matching,
   * so it is also what starts the matching run that creation skipped.
   */
  async moderate(
    id: string,
    body: ItemModerateBody,
    adminId: string,
  ): Promise<{ moderation: ModerationStatus; matching: MatchingOutcome }> {
    const { decision, reason } = body;
    const item = await this.items.findById(id);

    if (!item) throw new AppError('Item not found', 404);

    const current = item.moderation;

    // A decision that has already been made is not repeated: re-approving would
    // start a second matching run for the same item. An item with no field yet
    // is unset rather than approved, so an admin can still stamp a
    // pre-migration item as reviewed; it just reads as visible until they do.
    if (current === decision) {
      throw new AppError(`Item is already ${decision}`, 409);
    }

    await this.items.update(
      id,
      stripUndefined({
        moderation: decision,
        moderatedBy: adminId,
        moderatedAt: FieldValue.serverTimestamp(),
        // An approval clears the reason a previous rejection left behind.
        moderationReason: decision === 'rejected' ? reason : FieldValue.delete(),
      }),
    );

    await recordAdminAction({
      action: decision === 'approved' ? 'item_approved' : 'item_rejected',
      targetId: id,
      actorId: adminId,
      reason,
      details: { previousModeration: current ?? null, itemType: item.type },
    });

    if (decision !== 'approved') {
      return { moderation: decision, matching: 'not_started' };
    }

    // Only an item still looking for a counterpart is worth matching. An
    // approval on an already Matched or Claimed item is a moderation decision,
    // not a reason to re-run the pipeline over a settled pair.
    if (item.status !== 'Pending') {
      return { moderation: decision, matching: 'not_started' };
    }

    const input = toMatchingInput(item);

    if (!input) {
      log.info(`[MODERATE] ${id} approved but has no report date, matching skipped`);
      return { moderation: decision, matching: 'not_started' };
    }

    void this.runMatchingInBackground(id, input, item.cloudinaryUrls || []);

    return { moderation: decision, matching: 'pending' };
  }

  /**
   * Re-run matching for an item.
   *
   * Matching runs outside the request, so a restart or a deploy in the seconds
   * after a report is created loses that run and leaves the item Pending with
   * nothing to resume it. This is the manual resume.
   */
  async rematch(id: string): Promise<void> {
    const item = await this.items.findById(id);

    if (!item) throw new AppError('Item not found', 404);

    if (item.status !== 'Pending') {
      throw new AppError(`Only a Pending item can be rematched (is ${item.status})`, 400);
    }

    if (!isPubliclyVisible(item)) {
      throw new AppError('Approve the item before matching it', 400);
    }

    const input = toMatchingInput(item);

    if (!input) {
      throw new AppError('Item has no report date, so it cannot be matched', 400);
    }

    void this.runMatchingInBackground(id, input, item.cloudinaryUrls || []);
  }

  /**
   * Edit an item.
   *
   * The write is built from an explicit allowlist rather than a spread of the
   * request body: everything not named here is server owned (reportedBy,
   * matchedItemId, matchedUserId, claimedBy, verifiedAt, verificationConfidence)
   * and stays out of reach.
   */
  async update(id: string, body: ItemUpdateBody, user: AuthUser): Promise<StoredItem> {
    const existing = await this.items.findById(id);

    if (!existing) throw new AppError('Item not found', 404);

    if (!isOwnerOrAdmin(user, existing.reportedBy)) {
      throw new AppError('You can only edit your own reports', 403);
    }

    const fields = body.updates ?? {};
    const isAdmin = user.role === 'admin';

    const updateData: Record<string, unknown> = stripUndefined({
      name: fields.name,
      description: fields.description,
      location: fields.location,
      category: fields.category,
      color: fields.color,
      tags: fields.tags,
      // `??` not `||`: an empty string is a request to clear the field, and
      // `||` turned it into undefined, which stripUndefined then dropped, so
      // the old value survived.
      collectionPoint: fields.collectionPoint ?? fields.collectionLocation,
      collectionCoordinates: fields.collectionCoordinates,
      coordinates: fields.coordinates,
      date: fields.date ? Timestamp.fromDate(new Date(fields.date)) : undefined,
      // Lifecycle fields are an admin action, not something an owner can set on
      // their own report.
      status: isAdmin ? fields.status : undefined,
      type: isAdmin ? fields.type : undefined,
      matchScore: isAdmin ? fields.matchScore : undefined,
    });

    const existingUrls = existing.cloudinaryUrls || [];
    // The edit form lists the legacy single imageUrl alongside cloudinaryUrls,
    // so both count as URLs the item already owns.
    const ownedUrls = existing.imageUrl ? [...existingUrls, existing.imageUrl] : existingUrls;

    // cloudinaryUrls is only accepted as a removal: the edit form sends the
    // remaining URLs after the user deletes an image. Anything not already on
    // the item would let a caller point the record at an arbitrary URL.
    if (fields.cloudinaryUrls) {
      const unknownUrl = fields.cloudinaryUrls.find((url) => !ownedUrls.includes(url));

      if (unknownUrl) {
        throw new AppError('Images can only be removed, not replaced by URL', 400);
      }

      updateData.cloudinaryUrls = fields.cloudinaryUrls;
    }

    const newUrls = await this.uploadImages(body.images);

    if (newUrls.length > 0) {
      const keptUrls = (updateData.cloudinaryUrls as string[] | undefined) ?? existingUrls;
      updateData.cloudinaryUrls = [...keptUrls, ...newUrls];
    }

    const updated = await this.items.updateAndFetch(id, updateData);

    if (!updated) throw new AppError('Item not found', 404);

    return updated;
  }

  async updateStatus(
    id: string,
    status: ItemStatus,
    matchedUserId: string | undefined,
  ): Promise<void> {
    // matchedUserId is optional, and Firestore rejects an undefined value, so
    // the key is dropped rather than written as a hole.
    await this.items.update(id, stripUndefined({ status, matchedUserId }));
  }

  async remove(id: string, user: AuthUser): Promise<void> {
    const item = await this.items.findById(id);

    if (!item) throw new AppError('Item not found', 404);

    if (!isOwnerOrAdmin(user, item.reportedBy)) {
      throw new AppError('You can only delete your own reports', 403);
    }

    await this.deleteImages(item);
    await this.items.delete(id);
    await this.adjustUserCounts(item.reportedBy, item.type, 'decrement');
  }

  /**
   * Upload what the request carried, if anything.
   *
   * An upload failure is not a failed report: the item is still worth having
   * without its pictures, which is why this returns an empty list rather than
   * throwing.
   */
  private async uploadImages(images: string[] | undefined): Promise<string[]> {
    if (!images || images.length === 0 || !isCloudinaryConfigured()) return [];

    try {
      const results = await uploadMultipleImages(images);
      return results.map((result) => result.url);
    } catch (error) {
      log.error('Image upload failed:', error);
      return [];
    }
  }

  private async deleteImages(item: Item): Promise<void> {
    if (!item.cloudinaryUrls) return;

    for (const url of item.cloudinaryUrls) {
      const match = url.match(/reclaim-items\/([^.]+)/);

      if (match) {
        await deleteImage(`reclaim-items/${match[1]}`);
      }
    }
  }

  /** Counts are a convenience, so a failure is logged and not raised. */
  private async adjustUserCounts(
    userId: string,
    type: ItemType,
    operation: 'increment' | 'decrement',
  ): Promise<void> {
    try {
      await updateUserItemCounts(userId, type, operation);
    } catch (error) {
      log.error(`Failed to ${operation} user item counts:`, error);
    }
  }

  private logSemanticText(input: ItemInput): void {
    try {
      const embeddingText = createItemEmbeddingString({
        name: input.name,
        description: input.description,
        tags: input.tags,
        color: input.color,
      });

      log.info(`[ITEM-CREATE] Semantic text prepared: "${embeddingText}"`);
    } catch (error) {
      log.error('Failed to prepare semantic text:', error);
    }
  }

  /**
   * Run auto-matching outside the request.
   *
   * Nothing awaits this, so it owns its errors: an unhandled rejection here
   * would take the process down for an item that was already created.
   */
  private async runMatchingInBackground(
    itemId: string,
    item: ItemInput,
    cloudinaryUrls: string[],
  ): Promise<void> {
    let claimed = false;

    try {
      claimed = await this.items.claimMatchingRun(itemId, MATCHING_RUN_TTL_MS);

      if (!claimed) {
        log.info(`[MATCHING] A run is already in flight for ${itemId}, skipping`);
        return;
      }

      const result = await triggerAutoMatching(itemId, item.type, {
        name: item.name,
        description: item.description,
        tags: item.tags || [],
        color: item.color,
        imageUrl: cloudinaryUrls[0],
        cloudinaryUrls,
        coordinates: item.coordinates,
        location: item.location,
        date: new Date(item.date),
        category: item.category,
      });

      log.info(`[MATCHING] Finished for ${itemId}, best ${result?.highestScore ?? 0}%`);
    } catch (error) {
      log.error(`[MATCHING] Failed for ${itemId}:`, error);
    } finally {
      // Only the holder releases the claim, otherwise a rejected dispatch would
      // clear the marker belonging to the run that is actually working.
      if (claimed) {
        await this.items
          .releaseMatchingRun(itemId)
          .catch((error) =>
            log.error(`[MATCHING] Could not release the claim on ${itemId}:`, error),
          );
      }
    }
  }
}

/**
 * Rebuild the matching input from a stored item.
 *
 * Returns null when the item carries no report date: a legacy item cannot be
 * time-scored, and the pipeline needs a real Date rather than a missing one.
 */
function toMatchingInput(item: StoredItem): ItemInput | null {
  const date = (item.date as { toDate?: () => Date } | undefined)?.toDate?.();

  if (!date) return null;

  return {
    name: item.name,
    description: item.description || '',
    type: item.type,
    location: item.location || '',
    date,
    tags: item.tags || [],
    color: item.color,
    category: item.category,
    coordinates: item.coordinates,
    reportedBy: item.reportedBy || '',
  };
}

export const itemService = new ItemService();
