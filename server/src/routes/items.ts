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
} from '../middleware/index.js';
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
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { type, status, reportedBy, limit = '50' } = req.query;

    // The browse list is public, but filtering by owner is not: without this,
    // `?reportedBy=<victim-uid>` would enumerate another user's reports and
    // walk straight around the ownership guard on GET /user/:userId.
    if (reportedBy && !assertOwnerOrAdmin(req.user, reportedBy as string)) {
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

    const snapshot = await query.limit(parseInt(limit as string)).get();

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
 * POST /api/items
 * Create a new item (requires authentication)
 */
router.post(
  '/',
  authMiddleware,
  itemCreateLimiter,
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

    // Add collection location for Found items
    if (item.collectionLocation) {
      newItem.collectionLocation = item.collectionLocation;
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

    // Trigger automatic matching (non-blocking) with comprehensive scoring
    const imageUrl = cloudinaryUrls[0];
    log.info(`[ITEM-CREATE] Triggering auto-match for item ${itemId}`);
    log.info(`[ITEM-CREATE] - Tags: ${JSON.stringify(item.tags || [])}`);
    log.info(`[ITEM-CREATE] - Color: ${item.color || 'NONE'}`);
    log.info(`[ITEM-CREATE] - Coordinates: ${item.coordinates ? 'present' : 'MISSING'}`);
    log.info(`[ITEM-CREATE] - Date: ${item.date || 'MISSING'}`);
    log.info(`[ITEM-CREATE] - Image: ${imageUrl ? 'present' : 'MISSING'}`);

    const matchResult = await triggerAutoMatching(itemId, item.type, {
      name: item.name,
      description: item.description,
      tags: item.tags || [],
      color: item.color,
      imageUrl: imageUrl,
      coordinates: item.coordinates, // Pass coordinates for location matching
      location: item.location, // Pass location string for fallback
      date: new Date(item.date), // Pass date for time matching
      category: item.category, // Pass category for matching
    });

    return res.status(201).json({
      id: docRef.id,
      item: { id: docRef.id, ...newItem },
      matchResult,
    });
  }),
);

/**
 * PUT /api/items/:id
 * Update an item (requires authentication)
 */
router.put(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { updates, images } = req.body as {
      updates: Partial<ItemInput>;
      images?: string[]; // New base64 images
    };

    const docSnapshot = await collections.items.doc(id).get();
    if (!docSnapshot.exists) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const existing = docSnapshot.data() as Item;
    if (!assertOwnerOrAdmin(req.user, existing.reportedBy)) {
      return res.status(403).json({ error: 'You can only edit your own reports' });
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {
      ...updates,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Convert date if provided
    if (updates.date) {
      updateData.date = Timestamp.fromDate(new Date(updates.date));
    }

    // Upload new images if provided
    if (images && images.length > 0 && isCloudinaryConfigured()) {
      try {
        const results = await uploadMultipleImages(images);
        const newUrls = results.map((r) => r.url);
        // Append to existing or replace
        const existingItem = docSnapshot.data() as Item;
        updateData.cloudinaryUrls = [...(existingItem.cloudinaryUrls || []), ...newUrls];
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
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { status, matchedUserId } = req.body;

    const validStatuses = ['Pending', 'Matched', 'Claimed', 'Resolved'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await collections.items.doc(id).update({
      status,
      matchedUserId,
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
