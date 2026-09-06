/**
 * User Stats Service - Manage user item submission counts
 */

import { FieldValue } from 'firebase-admin/firestore';
import { itemRepository } from '../repositories/item.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { ItemType } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('userStats');

/**
 * Update user item counts when an item is submitted
 */
export async function updateUserItemCounts(
  userId: string,
  itemType: ItemType,
  operation: 'increment' | 'decrement' = 'increment',
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
    await userRepository.update(userId, updateData);

    log.info(`Updated ${itemType} item count for user ${userId}: ${operation} by 1`);

    return { success: true };
  } catch (error) {
    log.error('Error updating user item counts:', error);

    // If user document doesn't exist, create it with initial counts
    if (error instanceof Error && error.message.includes('No document to update')) {
      try {
        const initialData = {
          lostItemsCount: itemType === 'Lost' ? 1 : 0,
          foundItemsCount: itemType === 'Found' ? 1 : 0,
          totalItemsCount: 1,
        };

        await userRepository.merge(userId, initialData);
        log.info(`Created initial item counts for user ${userId}`);

        return { success: true };
      } catch (createError) {
        log.error('Error creating user item counts:', createError);
        return { success: false, error: 'Failed to create user item counts' };
      }
    }

    return { success: false, error: 'Failed to update user item counts' };
  }
}

/**
 * Initialize user item counts for a new user
 */
export async function initializeUserItemCounts(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await userRepository.merge(userId, {
      lostItemsCount: 0,
      foundItemsCount: 0,
      totalItemsCount: 0,
    });

    log.info(`Initialized item counts for new user ${userId}`);

    return { success: true };
  } catch (error) {
    log.error('Error initializing user item counts:', error);
    return { success: false, error: 'Failed to initialize user item counts' };
  }
}

/**
 * Recalculate user item counts from existing items (for data migration/fixing)
 */
export async function recalculateUserItemCounts(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get all items for this user
    const items = await itemRepository.listAllByReporter(userId);

    const lostCount = items.filter((item) => item.type === 'Lost').length;
    const foundCount = items.filter((item) => item.type === 'Found').length;
    const totalCount = items.length;

    // Update user with recalculated counts
    await userRepository.update(userId, {
      lostItemsCount: lostCount,
      foundItemsCount: foundCount,
      totalItemsCount: totalCount,
    });

    log.info(
      `Recalculated item counts for user ${userId}: Lost=${lostCount}, Found=${foundCount}, Total=${totalCount}`,
    );

    return { success: true };
  } catch (error) {
    log.error('Error recalculating user item counts:', error);
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
    const userData = await userRepository.findById(userId);

    return {
      lostItemsCount: userData?.lostItemsCount || 0,
      foundItemsCount: userData?.foundItemsCount || 0,
      totalItemsCount: userData?.totalItemsCount || 0,
    };
  } catch (error) {
    log.error('Error getting user item counts:', error);
    return {
      lostItemsCount: 0,
      foundItemsCount: 0,
      totalItemsCount: 0,
    };
  }
}
