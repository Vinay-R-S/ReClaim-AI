/**
 * User Stats Service - Manage user item submission counts
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import { ItemType } from '../types/index.js';

/**
 * Update user item counts when an item is submitted
 */
export async function updateUserItemCounts(
    userId: string,
    itemType: ItemType,
    operation: 'increment' | 'decrement' = 'increment'
): Promise<{ success: boolean; error?: string }> {
    try {
        const increment = operation === 'increment' ? 1 : -1;
        
        // Prepare update object based on item type
        const updateData: Record<string, FieldValue> = {
            totalItemsCount: FieldValue.increment(increment),
        };

        if (itemType === 'Lost') {
            updateData.lostItemsCount = FieldValue.increment(increment);
        } else if (itemType === 'Found') {
            updateData.foundItemsCount = FieldValue.increment(increment);
        }

        // Update user document
        await collections.users.doc(userId).update(updateData);

        console.log(`Updated ${itemType} item count for user ${userId}: ${operation} by 1`);
        
        return { success: true };
    } catch (error) {
        console.error('Error updating user item counts:', error);
        
        // If user document doesn't exist, create it with initial counts
        if (error instanceof Error && error.message.includes('No document to update')) {
            try {
                const initialData = {
                    lostItemsCount: itemType === 'Lost' ? 1 : 0,
                    foundItemsCount: itemType === 'Found' ? 1 : 0,
                    totalItemsCount: 1,
                };

                await collections.users.doc(userId).set(initialData, { merge: true });
                console.log(`Created initial item counts for user ${userId}`);
                
                return { success: true };
            } catch (createError) {
                console.error('Error creating user item counts:', createError);
                return { success: false, error: 'Failed to create user item counts' };
            }
        }

        return { success: false, error: 'Failed to update user item counts' };
    }
}

/**
 * Initialize user item counts for a new user
 */
export async function initializeUserItemCounts(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await collections.users.doc(userId).set({
            lostItemsCount: 0,
            foundItemsCount: 0,
            totalItemsCount: 0,
        }, { merge: true });

        console.log(`Initialized item counts for new user ${userId}`);
        
        return { success: true };
    } catch (error) {
        console.error('Error initializing user item counts:', error);
        return { success: false, error: 'Failed to initialize user item counts' };
    }
}

/**
 * Recalculate user item counts from existing items (for data migration/fixing)
 */
export async function recalculateUserItemCounts(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Get all items for this user
        const snapshot = await collections.items
            .where('reportedBy', '==', userId)
            .get();

        const items = snapshot.docs.map(doc => doc.data());
        
        const lostCount = items.filter(item => item.type === 'Lost').length;
        const foundCount = items.filter(item => item.type === 'Found').length;
        const totalCount = items.length;

        // Update user with recalculated counts
        await collections.users.doc(userId).update({
            lostItemsCount,
            foundItemsCount,
            totalItemsCount,
        });

        console.log(`Recalculated item counts for user ${userId}: Lost=${lostCount}, Found=${foundCount}, Total=${totalCount}`);
        
        return { success: true };
    } catch (error) {
        console.error('Error recalculating user item counts:', error);
        return { success: false, error: 'Failed to recalculate user item counts' };
    }
}

/**
 * Get user item counts
 */
export async function getUserItemCounts(userId: string): Promise<{
    lostItemsCount: number;
    foundItemsCount: number;
    totalItemsCount: number;
}> {
    try {
        const userDoc = await collections.users.doc(userId).get();
        const userData = userDoc.data();

        return {
            lostItemsCount: userData?.lostItemsCount || 0,
            foundItemsCount: userData?.foundItemsCount || 0,
            totalItemsCount: userData?.totalItemsCount || 0,
        };
    } catch (error) {
        console.error('Error getting user item counts:', error);
        return {
            lostItemsCount: 0,
            foundItemsCount: 0,
            totalItemsCount: 0,
        };
    }
}
