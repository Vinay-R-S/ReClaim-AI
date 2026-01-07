/**
 * Items API Routes - CRUD operations for lost/found items
 */

import { Router, Request, Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import { uploadImage, uploadMultipleImages, deleteImage, isCloudinaryConfigured } from '../services/cloudinary.js';
import { Item, ItemInput, ItemType } from '../types/index.js';
import { updateUserItemCounts } from '../services/userStats.js';
import { triggerAutoMatching } from '../services/autoMatch.service.js';

const router = Router();

/**
 * GET /api/items
 * Get all items (with optional filters)
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const { type, status, reportedBy, limit = '50' } = req.query;

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

        const items = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.json({ items });
    } catch (error) {
        console.error('Get items error:', error);
        return res.status(500).json({ error: 'Failed to get items' });
    }
});

/**
 * GET /api/items/:id
 * Get single item by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
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
    } catch (error) {
        console.error('Get item error:', error);
        return res.status(500).json({ error: 'Failed to get item' });
    }
});

/**
 * GET /api/items/user/:userId
 * Get all items reported by a specific user
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        const snapshot = await collections.items
            .where('reportedBy', '==', userId)
            .orderBy('createdAt', 'desc')
            .get();

        const items = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.json({ items });
    } catch (error) {
        console.error('Get user items error:', error);
        return res.status(500).json({ error: 'Failed to get user items' });
    }
});

/**
 * POST /api/items
 * Create a new item
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const { userId, item, images } = req.body as {
            userId: string;
            item: ItemInput;
            images?: string[]; // Base64 images
        };

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Upload images if provided
        let cloudinaryUrls: string[] = [];
        if (images && images.length > 0 && isCloudinaryConfigured()) {
            try {
                const results = await uploadMultipleImages(images);
                cloudinaryUrls = results.map(r => r.url);
            } catch (uploadError) {
                console.error('Image upload failed:', uploadError);
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
            cloudinaryUrls,
            reportedBy: userId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Add reporter email if provided
        if (item.reporterEmail) {
            newItem.reporterEmail = item.reporterEmail;
        }

        // Add collection location for Found items
        if (item.collectionLocation) {
            newItem.collectionLocation = item.collectionLocation;
        }

        // Only add coordinates if defined
        if (item.coordinates) {
            newItem.coordinates = item.coordinates;
        }

        const docRef = await collections.items.add(newItem);
        const itemId = docRef.id;

        console.log(`[ITEM-CREATE] Item created: ${itemId}, type: ${item.type}`);

        // Update user item counts
        try {
            await updateUserItemCounts(userId, item.type, 'increment');
        } catch (countError) {
            console.error('Failed to update user item counts:', countError);
            // Don't fail the request, just log the error
        }

        // Trigger automatic matching (non-blocking) with new staged approach
        const imageUrl = cloudinaryUrls[0];
        console.log(`[ITEM-CREATE] Triggering auto-match for item ${itemId}`);
        console.log(`[ITEM-CREATE] - Tags: ${JSON.stringify(item.tags || [])}`);
        console.log(`[ITEM-CREATE] - Color: ${item.color || 'NONE'}`);
        console.log(`[ITEM-CREATE] - Image: ${imageUrl ? 'present' : 'MISSING'}`);

        triggerAutoMatching(itemId, item.type, {
            name: item.name,
            description: item.description,
            tags: item.tags || [],
            color: item.color,
            imageUrl: imageUrl,
        }).catch(error => {
            console.error('[AUTO-MATCH] Error in automatic matching:', error);
        });

        return res.status(201).json({
            id: docRef.id,
            item: { id: docRef.id, ...newItem },
        });
    } catch (error) {
        console.error('Create item error:', error);
        return res.status(500).json({ error: 'Failed to create item' });
    }
});


/**
 * PUT /api/items/:id
 * Update an item
 */
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { updates, images } = req.body as {
            updates: Partial<ItemInput>;
            images?: string[]; // New base64 images
        };

        const docSnapshot = await collections.items.doc(id).get();
        if (!docSnapshot.exists) {
            return res.status(404).json({ error: 'Item not found' });
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
                const newUrls = results.map(r => r.url);
                // Append to existing or replace
                const existingItem = docSnapshot.data() as Item;
                updateData.cloudinaryUrls = [...(existingItem.cloudinaryUrls || []), ...newUrls];
            } catch (uploadError) {
                console.error('Image upload failed:', uploadError);
                // Continue without new images
            }
        }

        await collections.items.doc(id).update(updateData);

        // Fetch updated document
        const updatedDoc = await collections.items.doc(id).get();

        return res.json({
            success: true,
            item: { id: updatedDoc.id, ...updatedDoc.data() }
        });
    } catch (error) {
        console.error('Update item error:', error);
        return res.status(500).json({ error: 'Failed to update item' });
    }
});

/**
 * PUT /api/items/:id/status
 * Update item status (for admin handover)
 */
router.put('/:id/status', async (req: Request, res: Response) => {
    try {
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
    } catch (error) {
        console.error('Update status error:', error);
        return res.status(500).json({ error: 'Failed to update status' });
    }
});

/**
 * DELETE /api/items/:id
 * Delete an item
 */
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const doc = await collections.items.doc(id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const item = doc.data() as Item;

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
            console.error('Failed to update user item counts after deletion:', countError);
            // Don't fail the request, just log the error
        }

        return res.json({ success: true });
    } catch (error) {
        console.error('Delete item error:', error);
        return res.status(500).json({ error: 'Failed to delete item' });
    }
});

export default router;

