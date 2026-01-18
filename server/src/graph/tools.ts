/**
 * LangChain Tools for ReClaim AI Agent
 * Provides structured tools for data extraction, item saving, and matching
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { invokeLLMWithFallback, invokeLLMWithVision, invokeLLMWithMultipleImages } from './langchainConfig.js';
import { uploadImage } from '../services/cloudinary.js';
import { findMatchesForLostItem, findMatchesForFoundItem } from '../services/matching.js';
import { awardFoundItemCredits } from '../services/credits.js';
import { collections } from '../utils/firebase-admin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { CollectedItemData, MatchResult, ConversationContext } from './types.js';

/**
 * Tool: Extract item data from user message and/or image
 */
export const extractItemDataTool = tool(
    async (input: {
        message: string;
        currentData: CollectedItemData;
        context: ConversationContext;
        imageBase64?: string | string[]; // Support single or multiple images
    }): Promise<{
        extracted: Partial<CollectedItemData>;
        confidence: number;
    }> => {
        const { message, currentData, context, imageBase64 } = input;
        // Normalize to array for consistent handling
        const imagesArray = imageBase64
            ? (Array.isArray(imageBase64) ? imageBase64 : [imageBase64])
            : [];
        const hasImage = imagesArray.length > 0;
        const hasMultipleImages = imagesArray.length > 1;

        const prompt = hasImage
            ? `You are analyzing ${hasMultipleImages ? `multiple images (${imagesArray.length})` : 'an image'} of a ${context === 'report_lost' ? 'lost' : 'found'} item along with user text.

ANALYZE ALL IMAGES CAREFULLY. Synthesize details from every angle shown. Extract ALL visible details about the item.

User message: "${message || 'No text provided, analyze image only'}"

Current collected data: ${JSON.stringify(currentData)}

From the IMAGE, identify and extract:
- Item type/name (what is it? e.g., "iPhone 15 Pro", "Blue Wallet", "Car Keys")
- Color(s) visible
- Brand/logo if visible
- Size estimate
- Any distinguishing features, marks, or damage
- Text/numbers on the item

Return JSON:
{
  "name": "specific item name from image",
  "description": "detailed description from image analysis", 
  "color": "colors visible",
  "brand": "brand if identifiable",
  "size": "size if determinable",
  "tags": ["array", "of", "features", "visible"],
  "location": "location from user text if any",
  "date": "date from user text if any (ISO format)",
  "confidence": 0.0-1.0
}

Be thorough! Extract everything you can see in the image.`
            : `Extract item information from this user message for a ${context === 'report_lost' ? 'lost' : 'found'} item report.

CURRENT DATE/TIME REFERENCE: ${new Date().toISOString()}

Current collected data: ${JSON.stringify(currentData)}

User message: "${message}"

IMPORTANT DATE HANDLING:
- Convert ALL date references to ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)
- "yesterday" = subtract 1 day from current date
- "today" = current date
- "last Monday/Tuesday/etc" = calculate the actual date
- "2 days ago" = subtract 2 days from current date
- "morning" = around 09:00, "afternoon" = around 14:00, "evening" = around 18:00
- If no time specified, use 12:00 (noon)

Extract and return ONLY new/updated information in JSON format:
{
  "name": "item name if mentioned",
  "description": "item description if mentioned", 
  "color": "color if mentioned",
  "brand": "brand if mentioned",
  "size": "size if mentioned",
  "tags": ["array", "of", "features"],
  "location": "location if mentioned",
  "date": "MUST be ISO format date string (e.g., 2024-12-30T14:00:00.000Z) or null if no date mentioned",
  "confidence": 0.0-1.0 (how confident you are in the extraction)
}

Only include fields that have actual values from the message. Don't invent or assume information.`;

        try {
            let response: { content: string };

            if (hasImage) {
                // Use vision model for image analysis
                if (hasMultipleImages) {
                    console.log(`[ExtractDataTool] Using vision model for ${imagesArray.length} images`);
                    response = await invokeLLMWithMultipleImages(prompt, imagesArray, { temperature: 0.1 });
                } else {
                    console.log('[ExtractDataTool] Using vision model for single image');
                    response = await invokeLLMWithVision(prompt, imagesArray[0], { temperature: 0.1 });
                }
            } else {
                // Use regular LLM for text extraction
                response = await invokeLLMWithFallback([
                    {
                        role: 'system',
                        content: 'You are a data extraction assistant. Extract only factual information from user messages.'
                    },
                    { role: 'user', content: prompt },
                ], { temperature: 0.1 });
            }

            console.log('[ExtractDataTool] LLM response:', response.content.substring(0, 200));

            // Parse JSON from response
            let result: any;
            try {
                const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
                const jsonStr = jsonMatch ? jsonMatch[1] : response.content;
                result = JSON.parse(jsonStr.trim());
            } catch {
                console.error('[ExtractDataTool] Failed to parse JSON');
                return { extracted: {}, confidence: 0 };
            }

            const confidence = result.confidence || (hasImage ? 0.8 : 0.5);
            delete result.confidence;

            // Build extracted data
            const extracted: Partial<CollectedItemData> = {};

            if (result.name) {
                extracted.name = result.name;
            }
            if (result.color) {
                extracted.color = result.color;
            }

            // Build comprehensive description
            const descParts = [
                currentData.description,
                result.description,
                result.color && `Color: ${result.color}`,
                result.brand && `Brand: ${result.brand}`,
                result.size && `Size: ${result.size}`,
            ].filter(Boolean);

            if (descParts.length > 0) {
                extracted.description = descParts.join('. ');
            }

            if (result.tags && Array.isArray(result.tags)) {
                extracted.tags = [...new Set([...(currentData.tags || []), ...result.tags])];
            }
            if (result.location && result.location !== 'None' && result.location !== 'none' && result.location !== 'null') {
                extracted.location = result.location;
            }
            if (result.date && result.date !== 'None' && result.date !== 'none' && result.date !== 'null') {
                try {
                    const parsedDate = new Date(result.date);
                    // Only set date if it's valid
                    if (!isNaN(parsedDate.getTime())) {
                        extracted.date = parsedDate;
                    }
                } catch {
                    // Ignore invalid date
                }
            }

            console.log('[ExtractDataTool] Extracted data:', extracted);
            return { extracted, confidence };
        } catch (error) {
            console.error('[ExtractDataTool] Error:', error);
            return { extracted: {}, confidence: 0 };
        }
    },
    {
        name: 'extract_item_data',
        description: 'Extract item information from user message and/or uploaded images',
        schema: z.object({
            message: z.string().describe('User message text'),
            currentData: z.any().describe('Currently collected item data'),
            context: z.enum(['report_lost', 'report_found', 'check_matches', 'find_collection', 'idle']),
            imageBase64: z.union([z.string(), z.array(z.string())]).optional().describe('Base64 encoded image(s)'),
        }),
    }
);

/**
 * Tool: Upload image to Cloudinary
 */
export const uploadImageTool = tool(
    async (input: { imageBase64: string }): Promise<{ url: string; success: boolean }> => {
        try {
            const result = await uploadImage(input.imageBase64);
            console.log('[UploadImageTool] Uploaded:', result.url);
            return { url: result.url, success: true };
        } catch (error) {
            console.error('[UploadImageTool] Error:', error);
            return { url: '', success: false };
        }
    },
    {
        name: 'upload_image',
        description: 'Upload an image to cloud storage',
        schema: z.object({
            imageBase64: z.string().describe('Base64 encoded image data'),
        }),
    }
);

/**
 * Tool: Upload multiple images to Cloudinary
 */
export const uploadMultipleImagesTool = tool(
    async (input: { imagesBase64: string[] }): Promise<{ urls: string[]; success: boolean }> => {
        try {
            if (!input.imagesBase64 || input.imagesBase64.length === 0) {
                return { urls: [], success: true };
            }

            const uploadPromises = input.imagesBase64.map(img => uploadImage(img));
            const results = await Promise.all(uploadPromises);
            const urls = results.map(r => r.url);

            console.log(`[UploadMultipleImagesTool] Uploaded ${urls.length} images`);
            return { urls, success: true };
        } catch (error) {
            console.error('[UploadMultipleImagesTool] Error:', error);
            return { urls: [], success: false };
        }
    },
    {
        name: 'upload_multiple_images',
        description: 'Upload multiple images to cloud storage',
        schema: z.object({
            imagesBase64: z.array(z.string()).describe('Array of base64 encoded images'),
        }),
    }
);

/**
 * Tool: Save item to Firestore
 */
export const saveItemTool = tool(
    async (input: {
        itemData: CollectedItemData;
        userId: string;
        type: 'Lost' | 'Found';
    }): Promise<{ itemId: string; success: boolean }> => {
        try {
            const { itemData, userId, type } = input;

            // Ensure date is a proper Date object with validation
            let itemDate: Date;
            if (itemData.date instanceof Date && !isNaN(itemData.date.getTime())) {
                itemDate = itemData.date;
            } else if (itemData.date) {
                const parsed = new Date(itemData.date as any);
                // Check if the parsed date is valid
                if (!isNaN(parsed.getTime())) {
                    itemDate = parsed;
                } else {
                    console.warn('[SaveItemTool] Invalid date, using current date');
                    itemDate = new Date();
                }
            } else {
                itemDate = new Date();
            }

            // Build item document
            const itemDoc: Record<string, any> = {
                name: itemData.name || 'Unknown Item',
                description: itemData.description || '',
                type,
                status: 'Pending',
                location: itemData.location || 'Unknown',
                date: Timestamp.fromDate(itemDate),
                tags: itemData.tags || [],
                color: itemData.color || '',
                reportedBy: userId,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            };

            // Add coordinates if present
            if (itemData.coordinates) {
                itemDoc.coordinates = itemData.coordinates;
            }

            // Add cloudinary URLs if present
            if (itemData.cloudinaryUrls && itemData.cloudinaryUrls.length > 0) {
                itemDoc.cloudinaryUrls = itemData.cloudinaryUrls;
            }

            const docRef = await collections.items.add(itemDoc);
            console.log('[SaveItemTool] Saved item:', docRef.id);

            // Award credits for found items
            if (type === 'Found') {
                await awardFoundItemCredits(userId, docRef.id);
            }

            return { itemId: docRef.id, success: true };
        } catch (error) {
            console.error('[SaveItemTool] Error:', error);
            return { itemId: '', success: false };
        }
    },
    {
        name: 'save_item',
        description: 'Save an item to the database',
        schema: z.object({
            itemData: z.any().describe('Collected item data'),
            userId: z.string().describe('User ID who reported the item'),
            type: z.enum(['Lost', 'Found']).describe('Type of item report'),
        }),
    }
);

/**
 * Tool: Search for matches
 */
export const searchMatchesTool = tool(
    async (input: {
        itemData: CollectedItemData;
        type: 'Lost' | 'Found';
        imageBase64?: string | string[]; // Support single or multiple images
    }): Promise<{ matches: MatchResult[] }> => {
        try {
            const { itemData, type } = input;

            const searchParams = {
                name: itemData.name || 'Unknown Item',
                description: itemData.description || '',
                tags: itemData.tags,
                color: itemData.color,
                coordinates: itemData.coordinates,
                date: itemData.date instanceof Date ? itemData.date : new Date(itemData.date as any || Date.now()),
                cloudinaryUrls: itemData.cloudinaryUrls || [], // Pass cloudinary URLs for image matching
            };

            const matches = type === 'Lost'
                ? await findMatchesForLostItem(searchParams)
                : await findMatchesForFoundItem(searchParams);

            console.log('[SearchMatchesTool] Found matches:', matches.length);
            return { matches };
        } catch (error) {
            console.error('[SearchMatchesTool] Error:', error);
            return { matches: [] };
        }
    },
    {
        name: 'search_matches',
        description: 'Search for matching items in the database',
        schema: z.object({
            itemData: z.any().describe('Item data to match against'),
            type: z.enum(['Lost', 'Found']).describe('Type of item to search for'),
            imageBase64: z.union([z.string(), z.array(z.string())]).optional().describe('Image(s) for visual matching'),
        }),
    }
);

/**
 * Tool: Get collection points
 */
export const getCollectionPointsTool = tool(
    async (_input: {}): Promise<{ points: Array<{ name: string; address: string; hours?: string }> }> => {
        try {
            const snapshot = await collections.collectionPoints.get();
            const points = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    name: data.name,
                    address: data.address,
                    hours: data.hours,
                };
            });
            console.log('[GetCollectionPointsTool] Found points:', points.length);
            return { points };
        } catch (error) {
            console.error('[GetCollectionPointsTool] Error:', error);
            return { points: [] };
        }
    },
    {
        name: 'get_collection_points',
        description: 'Get list of collection points for found items',
        schema: z.object({}),
    }
);

/**
 * Tool: Get user's lost items
 */
export const getUserLostItemsTool = tool(
    async (input: { userId: string }): Promise<{ items: any[] }> => {
        try {
            const snapshot = await collections.items
                .where('reportedBy', '==', input.userId)
                .where('type', '==', 'Lost')
                .where('status', '==', 'Pending')
                .get();

            const items = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            }));

            console.log('[GetUserLostItemsTool] Found items:', items.length);
            return { items };
        } catch (error) {
            console.error('[GetUserLostItemsTool] Error:', error);
            return { items: [] };
        }
    },
    {
        name: 'get_user_lost_items',
        description: 'Get user\'s pending lost items',
        schema: z.object({
            userId: z.string().describe('User ID to get items for'),
        }),
    }
);

/**
 * Tool: Delete matched items
 */
export const deleteMatchedItemsTool = tool(
    async (input: { lostItemId: string; foundItemId: string }): Promise<{ success: boolean; deletedCount: number }> => {
        try {
            const { lostItemId, foundItemId } = input;

            // Delete both items
            const batch = collections.items.firestore.batch();

            if (lostItemId) {
                const lostRef = collections.items.doc(lostItemId);
                batch.delete(lostRef);
            }

            if (foundItemId) {
                const foundRef = collections.items.doc(foundItemId);
                batch.delete(foundRef);
            }

            await batch.commit();

            console.log(`[DeleteMatchedItemsTool] Deleted lost: ${lostItemId}, found: ${foundItemId}`);
            return { success: true, deletedCount: 2 };
        } catch (error) {
            console.error('[DeleteMatchedItemsTool] Error:', error);
            return { success: false, deletedCount: 0 };
        }
    },
    {
        name: 'delete_matched_items',
        description: 'Delete matched lost and found items from database',
        schema: z.object({
            lostItemId: z.string().describe('Lost item ID to delete'),
            foundItemId: z.string().describe('Found item ID to delete'),
        }),
    }
);
