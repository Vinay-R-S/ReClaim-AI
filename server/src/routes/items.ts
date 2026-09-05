/**
 * Items API Routes - CRUD operations for lost/found items
 * Protected routes require Firebase ID token authentication
 */

import { Router, Request, Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import {
  uploadImage,
  uploadMultipleImages,
  deleteImage,
  isCloudinaryConfigured,
} from '../services/cloudinary.js';
import { Item, ItemInput, ItemType } from '../types/index.js';
import { updateUserItemCounts } from '../services/userStats.js';
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
  itemStatusUpdateSchema,
  itemUpdateSchema,
  userIdParamsSchema,
  type ItemListQuery,
  type ItemStatusUpdateBody,
  type ItemUpdateBody,
} from '../schemas/index.js';
import { stripUndefined } from '../utils/firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('items');

const router = Router();

/**
 * GET /api/items
 * Get all items (with optional filters)
 */
router.get(
  '/',
  optionalAuthMiddleware,
  validateQuery(itemListQuerySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { type, status, reportedBy, limit } = req.query as unknown as ItemListQuery;

    // The browse list is public, but filtering by owner is not: without this,
    // `?reportedBy=<victim-uid>` would enumerate another user's reports and
    // walk straight around the ownership guard on GET /user/:userId.
    if (reportedBy && !assertOwnerOrAdmin(req.user, reportedBy)) {
      return res.status(403).json({ error: 'You can only list your own reports' });
    }

    let query = collections.items.orderBy('createdAt', 'desc');

    if (type) {
      query = query.where('type', '==', type);
    }
    if (status) {
      query = query.where('status', '==', status);
    }
    if (reportedBy) {
      query = query.where('reportedBy', '==', reportedBy);
    }

    const snapshot = await query.limit(limit).get();

    const items = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({ items });
  }),
);

/**
 * GET /api/items/:id
 * Get single item by ID
 */
router.get(
  '/:id',
  validateParams(idParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Skip if this looks like 'user' - handle in next route
    if (id === 'user') {
      return res.status(400).json({ error: 'Use /api/items/user/:userId' });
    }

    const doc = await collections.items.doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    return res.json({ item: { id: doc.id, ...doc.data() } });
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

/**
 * Run auto-matching outside the request.
 *
 * Nothing awaits this, so it owns its errors: an unhandled rejection here
 * would take the process down for an item that was already created.
 */
function runMatchingInBackground(
  itemId: string,
  item: ItemInput,
  cloudinaryUrls: string[],
): Promise<void> {
  return triggerAutoMatching(itemId, item.type, {
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
  })
    .then((result) => {
      log.info(`[ITEM-CREATE] Matching finished for ${itemId}, best ${result?.highestScore ?? 0}%`);
    })
    .catch((error) => {
      log.error(`[ITEM-CREATE] Matching failed for ${itemId}:`, error);
    });
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

    const newItem: Record<string, unknown> = {
      name: item.name,
      description: item.description,
      type: item.type,
      status: 'Pending' as const,
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
    void runMatchingInBackground(itemId, item, cloudinaryUrls);

    return res.status(201).json({
      id: docRef.id,
      item: { id: created.id, ...created.data() },
      matching: 'pending',
    });
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
    const date = (data.date as { toDate?: () => Date } | undefined)?.toDate?.();

    if (!date) {
      return res.status(400).json({ error: 'Item has no report date, so it cannot be matched' });
    }

    if (data.status !== 'Pending') {
      return res
        .status(400)
        .json({ error: `Only a Pending item can be rematched (is ${data.status})` });
    }

    void runMatchingInBackground(
      id,
      {
        name: data.name as string,
        description: (data.description as string) || '',
        type: data.type as ItemInput['type'],
        location: (data.location as string) || '',
        date,
        tags: (data.tags as string[]) || [],
        color: data.color as string | undefined,
        category: data.category as string | undefined,
        reportedBy: (data.reportedBy as string) || '',
      },
      (data.cloudinaryUrls as string[]) || [],
    );

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
