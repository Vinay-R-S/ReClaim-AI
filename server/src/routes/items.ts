/**
 * Items API Routes - CRUD operations for lost/found items
 * Protected routes require Firebase ID token authentication
 */

import { Router, Request, Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { collections, db } from '../utils/firebase-admin.js';
import {
  uploadImage,
  uploadMultipleImages,
  deleteImage,
  isCloudinaryConfigured,
} from '../services/cloudinary.js';
import { Item, ItemInput, ItemType, ModerationStatus } from '../types/index.js';
import { updateUserItemCounts } from '../services/userStats.js';
import { listAdminAuditForTarget, recordAdminAction } from '../services/audit.service.js';
import { triggerAutoMatching } from '../services/autoMatch.service.js';
import { createItemEmbeddingString } from '../utils/embeddings.js';
import {
  assertOwnerOrAdmin,
  asyncHandler,
  authMiddleware,
  AuthRequest,
  itemCreateLimiter,
  optionalAuthMiddleware,
  requireAdmin,
  requireOwnership,
  validate,
  validateParams,
  validateQuery,
} from '../middleware/index.js';
import {
  idParamsSchema,
  itemInputSchema,
  itemListQuerySchema,
  itemModerateSchema,
  itemStatusUpdateSchema,
  itemUpdateSchema,
  userIdParamsSchema,
  type ItemListQuery,
  type ItemModerateBody,
  type ItemStatusUpdateBody,
  type ItemUpdateBody,
} from '../schemas/index.js';
import { stripUndefined } from '../utils/firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('items');

const router = Router();

/**
 * Whether an item may be shown to someone who is not an admin.
 *
 * Items created before moderation existed carry no field and read as approved:
 * the alternative is that every legacy item vanishes from the browse list the
 * moment this deploys, and stays gone until the migration runs.
 */
function isPubliclyVisible(item: { moderation?: ModerationStatus }): boolean {
  return item.moderation === undefined || item.moderation === 'approved';
}

/**
 * GET /api/items
 * Get all items (with optional filters)
 */
router.get(
  '/',
  optionalAuthMiddleware,
  validateQuery(itemListQuerySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { type, status, moderation, reportedBy, limit } = req.query as unknown as ItemListQuery;
    const isAdmin = req.user?.role === 'admin';

    // The browse list is public, but filtering by owner is not: without this,
    // `?reportedBy=<victim-uid>` would enumerate another user's reports and
    // walk straight around the ownership guard on GET /user/:userId.
    if (reportedBy && !assertOwnerOrAdmin(req.user, reportedBy)) {
      return res.status(403).json({ error: 'You can only list your own reports' });
    }

    // An explicit moderation filter has to be a real query filter: applied
    // after `limit` it silently returned an empty review queue whenever the
    // newest page happened to be all approved. Dropping `orderBy` keeps this
    // to equality filters only, which Firestore serves from single-field
    // indexes; the page is sorted below instead. Legacy documents are absent
    // from the result either way, which is correct for an explicit filter.
    const filterModeration = Boolean(moderation) && isAdmin;

    let query = filterModeration
      ? collections.items.where('moderation', '==', moderation)
      : collections.items.orderBy('createdAt', 'desc');

    if (type) {
      query = query.where('type', '==', type);
    }
    if (status) {
      query = query.where('status', '==', status);
    }
    if (reportedBy) {
      query = query.where('reportedBy', '==', reportedBy);
    }
    // An unfiltered query is already ordered and bounded by Firestore. A
    // moderation-filtered one is sorted and bounded here, after the fetch.
    const snapshot = await (filterModeration ? query.get() : query.limit(limit).get());

    const items = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as (Item & { id: string })[];

    if (filterModeration) {
      const sorted = items
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
        .slice(0, limit);

      return res.json({ items: sorted });
    }

    // Without an explicit filter, visibility is decided in memory: a legacy
    // item has no `moderation` field at all, and an equality filter would drop
    // every one of them from the browse list. An owner sees their own
    // unreviewed reports; everyone else sees approved items only.
    const ownList = Boolean(reportedBy) && assertOwnerOrAdmin(req.user, reportedBy);
    const visible = isAdmin || ownList ? items : items.filter(isPubliclyVisible);

    return res.json({ items: visible });
  }),
);

/**
 * GET /api/items/:id
 * Get single item by ID
 */
router.get(
  '/:id',
  optionalAuthMiddleware,
  validateParams(idParamsSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;

    // Skip if this looks like 'user' - handle in next route
    if (id === 'user') {
      return res.status(400).json({ error: 'Use /api/items/user/:userId' });
    }

    const doc = await collections.items.doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = doc.data() as Item;

    // The same gate the list applies. Without it an unreviewed or rejected
    // report stayed fully readable, reporter email and collection point
    // included, to anyone holding its id. The reporter and admins still see
    // their own, which is what the post-report poll needs.
    if (!isPubliclyVisible(item) && !assertOwnerOrAdmin(req.user, item.reportedBy)) {
      return res.status(404).json({ error: 'Item not found' });
    }

    return res.json({ item: { ...item, id: doc.id } });
  }),
);

/**
 * GET /api/items/user/:userId
 * Get all items reported by a specific user
 */
router.get(
  '/user/:userId',
  authMiddleware,
  validateParams(userIdParamsSchema),
  requireOwnership((req) => req.params.userId),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const snapshot = await collections.items
      .where('reportedBy', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const items = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({ items });
  }),
);

/** How long a matching run holds its claim before another may take it over. */
const MATCHING_RUN_TTL_MS = 5 * 60 * 1000;

/**
 * Claim the right to run matching for an item.
 *
 * Creation, approval and the manual rematch all dispatch a detached pipeline
 * with nothing recording that one is already in flight. Two admins acting at
 * once, or an approval followed straight away by a rematch, would score the
 * same item twice, and each run can cross the threshold against a different
 * counterpart and open its own handover for one report.
 *
 * The claim is transactional. A run whose process dies without releasing it is
 * taken over after `MATCHING_RUN_TTL_MS` rather than blocking the item.
 */
async function claimMatchingRun(itemId: string): Promise<boolean> {
  const ref = collections.items.doc(itemId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);

    if (!snapshot.exists) return false;

    const startedAt = snapshot.data()?.matchingStartedAt as Timestamp | undefined;

    if (startedAt && Date.now() - startedAt.toMillis() < MATCHING_RUN_TTL_MS) return false;

    tx.update(ref, { matchingStartedAt: Timestamp.now() });

    return true;
  });
}

/**
 * Run auto-matching outside the request.
 *
 * Nothing awaits this, so it owns its errors: an unhandled rejection here
 * would take the process down for an item that was already created.
 */
async function runMatchingInBackground(
  itemId: string,
  item: ItemInput,
  cloudinaryUrls: string[],
): Promise<void> {
  let claimed = false;

  try {
    claimed = await claimMatchingRun(itemId);

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
      await collections.items
        .doc(itemId)
        .update({ matchingStartedAt: FieldValue.delete() })
        .catch((error) => log.error(`[MATCHING] Could not release the claim on ${itemId}:`, error));
    }
  }
}

/**
 * POST /api/items
 * Create a new item (requires authentication)
 */
router.post(
  '/',
  authMiddleware,
  itemCreateLimiter,
  validate(itemInputSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Use authenticated user ID instead of body parameter
    const userId = req.user!.uid;
    const { item, images } = req.body as {
      item: ItemInput;
      images?: string[]; // Base64 images
    };

    // Upload images if provided
    let cloudinaryUrls: string[] = [];
    if (images && images.length > 0 && isCloudinaryConfigured()) {
      try {
        const results = await uploadMultipleImages(images);
        cloudinaryUrls = results.map((r) => r.url);
      } catch (uploadError) {
        log.error('Image upload failed:', uploadError);
        // Continue without images
      }
    }

    // An admin creating an item is the review: the add-item and CCTV register
    // flows would otherwise queue their own work for themselves.
    const moderation: ModerationStatus = req.user?.role === 'admin' ? 'approved' : 'pending';

    const newItem: Record<string, unknown> = {
      name: item.name,
      description: item.description,
      type: item.type,
      status: 'Pending' as const,
      moderation,
      location: item.location,
      date: Timestamp.fromDate(new Date(item.date)),
      tags: item.tags || [],
      color: item.color || '', // Add color for matching
      category: item.category || 'Other', // Add category for matching
      cloudinaryUrls,
      reportedBy: userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Add reporter email if provided (stored as reportedByEmail for handover.service.ts)
    if (item.reporterEmail) {
      newItem.reportedByEmail = item.reporterEmail;
    }

    // Collection details for Found items. The form sends `collectionLocation`
    // and every consumer reads `collectionPoint`, which is why the handover
    // email showed the found-at location and the admin screen showed nothing.
    // One canonical name is written here, whichever alias arrived.
    const collectionPoint = item.collectionPoint || item.collectionLocation;

    if (collectionPoint) {
      newItem.collectionPoint = collectionPoint;
    }

    if (item.collectionCoordinates) {
      newItem.collectionCoordinates = item.collectionCoordinates;
    }

    // Only add coordinates if defined
    if (item.coordinates) {
      newItem.coordinates = item.coordinates;
    }

    // Create embedding string for potential future use (or logging)
    try {
      const embeddingText = createItemEmbeddingString({
        name: item.name,
        description: item.description,
        tags: item.tags,
        color: item.color,
      });
      log.info(`[ITEM-CREATE] Semantic text prepared: "${embeddingText}"`);
    } catch (embedError) {
      log.error('Failed to prepare semantic text:', embedError);
    }

    const docRef = await collections.items.add(newItem);
    const itemId = docRef.id;

    log.info(`[ITEM-CREATE] Item created: ${itemId}, type: ${item.type}`);

    // Update user item counts
    try {
      await updateUserItemCounts(userId, item.type, 'increment');
    } catch (countError) {
      log.error('Failed to update user item counts:', countError);
      // Don't fail the request, just log the error
    }

    // Read the document back rather than echoing `newItem`: it still holds
    // unresolved `serverTimestamp()` sentinels, which serialise to `{}` and
    // give any client rendering `createdAt` an invalid date.
    const created = await docRef.get();

    // Matching runs after the response. It calls an LLM and a vision API per
    // candidate, so awaiting it made report submission as slow and as fragile
    // as the slowest provider, and a matching failure returned 500 for an item
    // that had already been persisted. The result is picked up by polling
    // `GET /api/items/:id`.
    //
    // It only runs for an item that has cleared review. Matching an unreviewed
    // report can initiate a handover and email a stranger a collection code,
    // which is exactly what the moderation gate exists to stop.
    if (moderation === 'approved') {
      void runMatchingInBackground(itemId, item, cloudinaryUrls);
    }

    return res.status(201).json({
      id: docRef.id,
      item: { id: created.id, ...created.data() },
      matching: moderation === 'approved' ? 'pending' : 'awaiting_review',
    });
  }),
);

/**
 * Rebuild the matching input from a stored document.
 *
 * Returns null when the item carries no report date: a legacy item cannot be
 * time-scored, and the pipeline needs a real Date rather than a missing one.
 */
function toMatchingInput(data: Record<string, unknown>): ItemInput | null {
  const date = (data.date as { toDate?: () => Date } | undefined)?.toDate?.();

  if (!date) return null;

  return {
    name: data.name as string,
    description: (data.description as string) || '',
    type: data.type as ItemType,
    location: (data.location as string) || '',
    date,
    tags: (data.tags as string[]) || [],
    color: data.color as string | undefined,
    category: data.category as string | undefined,
    coordinates: data.coordinates as ItemInput['coordinates'],
    reportedBy: (data.reportedBy as string) || '',
  };
}

/**
 * POST /api/items/:id/moderate
 * Admin: approve or reject a reported item.
 *
 * Approval is what makes an item publicly visible and eligible for matching,
 * so it is also what starts the matching run that item creation deliberately
 * skipped. Rejection stops the item there and records why.
 */
router.post(
  '/:id/moderate',
  authMiddleware,
  requireAdmin,
  validateParams(idParamsSchema),
  validate(itemModerateSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { decision, reason } = req.body as ItemModerateBody;
    const adminId = req.user!.uid;

    const doc = await collections.items.doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const data = doc.data() as Record<string, unknown>;
    const current = data.moderation as ModerationStatus | undefined;

    // A decision that has already been made is not repeated: re-approving
    // would start a second matching run for the same item. An item with no
    // field yet is unset rather than approved, so an admin can still stamp a
    // pre-migration item as reviewed; it just reads as visible until they do.
    if (current === decision) {
      return res.status(409).json({ error: `Item is already ${decision}` });
    }

    await collections.items.doc(id).update(
      stripUndefined({
        moderation: decision,
        moderatedBy: adminId,
        moderatedAt: FieldValue.serverTimestamp(),
        // An approval clears the reason a previous rejection left behind.
        moderationReason: decision === 'rejected' ? reason : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
    );

    await recordAdminAction({
      action: decision === 'approved' ? 'item_approved' : 'item_rejected',
      targetId: id,
      actorId: adminId,
      reason,
      details: { previousModeration: current ?? null, itemType: data.type },
    });

    if (decision !== 'approved') {
      return res.json({ success: true, moderation: decision, matching: 'not_started' });
    }

    // Only an item still looking for a counterpart is worth matching. An
    // approval on an already Matched or Claimed item is a moderation decision,
    // not a reason to re-run the pipeline over a settled pair.
    if (data.status !== 'Pending') {
      return res.json({ success: true, moderation: decision, matching: 'not_started' });
    }

    const input = toMatchingInput(data);

    if (!input) {
      log.info(`[MODERATE] ${id} approved but has no report date, matching skipped`);
      return res.json({ success: true, moderation: decision, matching: 'not_started' });
    }

    void runMatchingInBackground(id, input, (data.cloudinaryUrls as string[]) || []);

    return res.json({ success: true, moderation: decision, matching: 'pending' });
  }),
);

/**
 * GET /api/items/:id/audit
 * Admin: the review decisions taken on this item, newest first.
 */
router.get(
  '/:id/audit',
  authMiddleware,
  requireAdmin,
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const entries = await listAdminAuditForTarget(req.params.id);

    return res.json({ entries });
  }),
);

/**
 * POST /api/items/:id/rematch
 * Admin: re-run matching for an item.
 *
 * Matching runs outside the request, so a restart or a deploy in the seconds
 * after a report is created loses that run and leaves the item Pending with
 * nothing to resume it. This is the manual resume.
 */
router.post(
  '/:id/rematch',
  authMiddleware,
  requireAdmin,
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const doc = await collections.items.doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const data = doc.data() as Record<string, unknown>;

    if (data.status !== 'Pending') {
      return res
        .status(400)
        .json({ error: `Only a Pending item can be rematched (is ${data.status})` });
    }

    if (!isPubliclyVisible(data as { moderation?: ModerationStatus })) {
      return res.status(400).json({ error: 'Approve the item before matching it' });
    }

    const input = toMatchingInput(data);

    if (!input) {
      return res.status(400).json({ error: 'Item has no report date, so it cannot be matched' });
    }

    void runMatchingInBackground(id, input, (data.cloudinaryUrls as string[]) || []);

    return res.json({ success: true, message: 'Matching restarted' });
  }),
);

/**
 * PUT /api/items/:id
 * Update an item (requires authentication)
 */
router.put(
  '/:id',
  authMiddleware,
  validateParams(idParamsSchema),
  validate(itemUpdateSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { updates, images } = req.body as ItemUpdateBody;

    const docSnapshot = await collections.items.doc(id).get();
    if (!docSnapshot.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const existing = docSnapshot.data() as Item;
    if (!assertOwnerOrAdmin(req.user, existing.reportedBy)) {
      return res.status(403).json({ error: 'You can only edit your own reports' });
    }

    const fields = updates ?? {};
    const isAdmin = req.user?.role === 'admin';

    // Explicit allowlist rather than a spread of the request body: everything
    // not named here is server owned (reportedBy, matchedItemId, matchedUserId,
    // claimedBy, verifiedAt, verificationConfidence) and stays out of reach.
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

    updateData.updatedAt = FieldValue.serverTimestamp();

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
        return res.status(400).json({ error: 'Images can only be removed, not replaced by URL' });
      }
      updateData.cloudinaryUrls = fields.cloudinaryUrls;
    }

    // Upload new images if provided
    if (images && images.length > 0 && isCloudinaryConfigured()) {
      try {
        const results = await uploadMultipleImages(images);
        const newUrls = results.map((r) => r.url);
        const keptUrls = (updateData.cloudinaryUrls as string[] | undefined) ?? existingUrls;
        updateData.cloudinaryUrls = [...keptUrls, ...newUrls];
      } catch (uploadError) {
        log.error('Image upload failed:', uploadError);
        // Continue without new images
      }
    }

    await collections.items.doc(id).update(updateData);

    // Fetch updated document
    const updatedDoc = await collections.items.doc(id).get();

    return res.json({
      success: true,
      item: { id: updatedDoc.id, ...updatedDoc.data() },
    });
  }),
);

/**
 * PUT /api/items/:id/status
 * Update item status (requires authentication)
 */
router.put(
  '/:id/status',
  authMiddleware,
  requireAdmin,
  validateParams(idParamsSchema),
  validate(itemStatusUpdateSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { status, matchedUserId } = req.body as ItemStatusUpdateBody;

    // matchedUserId is optional, and Firestore rejects an undefined value, so
    // the key is dropped rather than written as a hole.
    const updateData = stripUndefined({ status, matchedUserId });

    await collections.items.doc(id).update({
      ...updateData,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  }),
);

/**
 * DELETE /api/items/:id
 * Delete an item (requires authentication)
 */
router.delete(
  '/:id',
  authMiddleware,
  validateParams(idParamsSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;

    const doc = await collections.items.doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = doc.data() as Item;

    if (!assertOwnerOrAdmin(req.user, item.reportedBy)) {
      return res.status(403).json({ error: 'You can only delete your own reports' });
    }

    // Delete images from Cloudinary
    if (item.cloudinaryUrls) {
      for (const url of item.cloudinaryUrls) {
        // Extract public ID from URL
        const match = url.match(/reclaim-items\/([^.]+)/);
        if (match) {
          await deleteImage(`reclaim-items/${match[1]}`);
        }
      }
    }

    await collections.items.doc(id).delete();

    // Update user item counts
    try {
      await updateUserItemCounts(item.reportedBy, item.type, 'decrement');
    } catch (countError) {
      log.error('Failed to update user item counts after deletion:', countError);
      // Don't fail the request, just log the error
    }

    return res.json({ success: true });
  }),
);

export default router;
