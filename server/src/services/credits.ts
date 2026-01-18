/**
 * Credits Service - Manage user credit points
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import { CREDIT_VALUES, CreditTransaction, User } from '../types/index.js';
import { sendCreditsNotification } from './email.js';

type CreditReason = keyof typeof CREDIT_VALUES;

const REASON_DESCRIPTIONS: Record<CreditReason, string> = {
    SIGNUP_BONUS: 'Welcome bonus for joining ReClaim AI',
    REPORT_FOUND: 'Reporting a found item',
    SUCCESSFUL_MATCH_FINDER: 'Your found item was claimed successfully',
    SUCCESSFUL_MATCH_OWNER: 'Successfully claiming your lost item',
    FALSE_CLAIM: 'False claim penalty',
};

/**
 * Get user's current credits
 */
export async function getUserCredits(userId: string): Promise<number> {
    try {
        const userDoc = await collections.users.doc(userId).get();
        const userData = userDoc.data() as User | undefined;
        return userData?.credits ?? 0;
    } catch (error) {
        console.error('Error getting user credits:', error);
        return 0;
    }
}

/**
 * Add or deduct credits from a user
 */
export async function updateCredits(
    userId: string,
    reason: CreditReason,
    relatedItemId?: string,
    sendNotification: boolean = true
): Promise<{ success: boolean; newBalance: number; amount: number }> {
    const amount = CREDIT_VALUES[reason];

    try {
        // Update user credits atomically
        await collections.users.doc(userId).update({
            credits: FieldValue.increment(amount),
        });

        // Get new balance
        const userDoc = await collections.users.doc(userId).get();
        const userData = userDoc.data() as User;
        const newBalance = userData.credits ?? amount;

        // Log transaction
        const transaction: Omit<CreditTransaction, 'id'> = {
            userId,
            amount,
            reason: reason.toLowerCase().replace(/_/g, '_') as any,
            relatedItemId,
            createdAt: FieldValue.serverTimestamp() as any,
        };

        await collections.creditTransactions.add(transaction);

        // Send notification if credits increased and user has email
        if (sendNotification && amount > 0 && userData.email) {
            await sendCreditsNotification(
                userData.email,
                amount,
                REASON_DESCRIPTIONS[reason],
                newBalance
            );
        }

        console.log(`Credits updated for user ${userId}: ${amount > 0 ? '+' : ''}${amount}, new balance: ${newBalance}`);

        return { success: true, newBalance, amount };
    } catch (error) {
        console.error('Error updating credits:', error);
        return { success: false, newBalance: 0, amount };
    }
}

/**
 * Award credits for reporting a found item
 */
export async function awardFoundItemCredits(
    userId: string,
    itemId: string
): Promise<{ success: boolean; newBalance: number }> {
    const result = await updateCredits(userId, 'REPORT_FOUND', itemId);
    return { success: result.success, newBalance: result.newBalance };
}

/**
 * Award credits for successful match (both finder and owner)
 */
export async function awardMatchCredits(
    finderId: string,
    ownerId: string,
    itemId: string
): Promise<void> {
    // Award finder
    await updateCredits(finderId, 'SUCCESSFUL_MATCH_FINDER', itemId);

    // Award owner
    await updateCredits(ownerId, 'SUCCESSFUL_MATCH_OWNER', itemId);
}

/**
 * Deduct credits for false claim
 */
export async function penalizeFalseClaim(
    userId: string,
    itemId: string
): Promise<{ success: boolean; newBalance: number }> {
    const result = await updateCredits(userId, 'FALSE_CLAIM', itemId, false); // Don't notify for penalties
    return { success: result.success, newBalance: result.newBalance };
}

/**
 * Get credit transaction history for a user
 */
export async function getCreditHistory(
    userId: string,
    limit: number = 10
): Promise<CreditTransaction[]> {
    try {
        // Note: Not using orderBy to avoid requiring a composite index
        // Results are sorted client-side instead
        const snapshot = await collections.creditTransactions
            .where('userId', '==', userId)
            .limit(limit * 2) // Get more to sort properly
            .get();

        const transactions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        })) as CreditTransaction[];

        // Sort by createdAt descending client-side
        return transactions
            .sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(0);
                const dateB = b.createdAt?.toDate?.() || new Date(0);
                return dateB.getTime() - dateA.getTime();
            })
            .slice(0, limit);
    } catch (error) {
        console.error('Error getting credit history:', error);
        return [];
    }
}

/**
 * Award signup bonus to new user
 */
export async function awardSignupBonus(
    userId: string
): Promise<{ success: boolean; newBalance: number }> {
    const result = await updateCredits(userId, 'SIGNUP_BONUS', undefined, false);
    return { success: result.success, newBalance: result.newBalance };
}

/**
 * Initialize credits for new user
 */
export async function initializeCredits(userId: string): Promise<void> {
    try {
        await collections.users.doc(userId).update({
            credits: 0,
        });
    } catch (error) {
        console.error('Error initializing credits:', error);
    }
}
