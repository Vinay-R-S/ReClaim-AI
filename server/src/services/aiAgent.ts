/**
 * AI Agent Service - Orchestrates the chat interaction
 */

import {
    Conversation,
    ChatRequest,
    ChatResponse,
    ConversationContext,
    ItemInput,
    SAFETY_LIMITS,
} from '../types/index.js';
import {
    getOrCreateConversation,
    updateConversation,
    addMessage,
    getGreetingMessage,
    extractItemData,
    getNextQuestion,
    generateAIResponse,
} from '../agents/conversationManager.js';
import {
    checkTurnLimit,
    checkInvalidAttempts,
    validateUserInput,
    getInvalidInputWarning,
} from '../utils/safety.js';
import { findMatchesForLostItem, findMatchesForFoundItem } from './matching.js';
import { uploadImage } from './cloudinary.js';
import { awardFoundItemCredits } from './credits.js';
import { collections } from '../utils/firebase-admin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * Process a chat message and return response
 */
export async function processChat(
    userId: string,
    request: ChatRequest
): Promise<ChatResponse> {
    const { conversationId, message, context, imageData, location } = request;

    // Get or create conversation
    const conversation = await getOrCreateConversation(
        userId,
        context || 'idle',
        conversationId
    );

    // If this is a new conversation with context, return greeting
    if (conversation.turnCount === 0 && context && context !== 'idle') {
        const greeting = getGreetingMessage(context);

        // Add assistant greeting to conversation
        await addMessage(conversation.id, {
            role: 'assistant',
            content: greeting.content,
            metadata: { chips: greeting.chips },
        });

        return {
            conversationId: conversation.id,
            message: greeting.content,
            state: conversation.state,
            chips: greeting.chips,
            isComplete: false,
        };
    }

    // Check safety limits
    const turnCheck = checkTurnLimit(conversation.turnCount);
    if (!turnCheck.isValid) {
        await terminateConversation(conversation.id, turnCheck.reason!);
        return {
            conversationId: conversation.id,
            message: turnCheck.reason!,
            state: 'terminated',
            chips: getGreetingMessage('idle').chips,
            isComplete: true,
        };
    }

    // Validate user input
    const validation = await validateUserInput(message, conversation.context);
    const invalidCheck = checkInvalidAttempts(conversation.invalidAttempts, validation.isValid);

    if (!invalidCheck.isValid && invalidCheck.shouldTerminate) {
        await terminateConversation(conversation.id, invalidCheck.reason!);
        return {
            conversationId: conversation.id,
            message: invalidCheck.reason!,
            state: 'terminated',
            chips: getGreetingMessage('idle').chips,
            isComplete: true,
        };
    }

    // Add user message
    await addMessage(conversation.id, {
        role: 'user',
        content: message,
        metadata: location ? { location } : undefined,
    });

    // If input was invalid, give warning
    if (!validation.isValid) {
        const warning = getInvalidInputWarning(invalidCheck.newInvalidCount!);
        await updateConversation(conversation.id, { invalidAttempts: invalidCheck.newInvalidCount });

        await addMessage(conversation.id, {
            role: 'assistant',
            content: warning,
        });

        return {
            conversationId: conversation.id,
            message: warning,
            state: conversation.state,
            isComplete: false,
        };
    }

    // Reset invalid attempts on valid input
    if (invalidCheck.newInvalidCount === 0 && conversation.invalidAttempts > 0) {
        await updateConversation(conversation.id, { invalidAttempts: 0 });
    }

    // Process based on context
    switch (conversation.context) {
        case 'report_lost':
            return handleReportLost(conversation, message, imageData, location);

        case 'report_found':
            return handleReportFound(conversation, message, imageData, location, userId);

        case 'check_matches':
            return handleCheckMatches(conversation, userId);

        case 'find_collection':
            return handleFindCollection(conversation, message, location);

        default:
            return handleGenericQuery(conversation, message);
    }
}

/**
 * Handle "Report Lost Item" flow
 */
async function handleReportLost(
    conversation: Conversation,
    message: string,
    imageData?: string,
    location?: { lat: number; lng: number }
): Promise<ChatResponse> {
    // Extract data from message AND image if provided
    const { extracted } = await extractItemData(message, conversation.extractedData, 'report_lost', imageData);

    // Merge with existing data
    const updatedData: Partial<ItemInput> = {
        ...conversation.extractedData,
        ...extracted,
    };

    // Handle location
    if (location) {
        updatedData.coordinates = location;
        if (!updatedData.location) {
            updatedData.location = `Near (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;
        }
    }

    // Handle date default
    if (!updatedData.date) {
        updatedData.date = new Date();
    }

    // Handle image
    let imageUrl: string | undefined;
    if (imageData) {
        try {
            const result = await uploadImage(imageData);
            imageUrl = result.url;
            (updatedData as any).cloudinaryUrls = [result.url];
        } catch (error) {
            console.error('Image upload failed:', error);
        }
    }

    // Get next question
    const { question, nextState, chips } = getNextQuestion(
        conversation.state,
        updatedData,
        'report_lost'
    );

    // Update conversation
    await updateConversation(conversation.id, {
        state: nextState,
        extractedData: updatedData,
    });

    // If we're at search_matches state, actually search
    if (nextState === 'search_matches') {
        // Ensure date is a proper Date object
        let itemDate: Date;
        if (updatedData.date instanceof Date) {
            itemDate = updatedData.date;
        } else if (updatedData.date) {
            itemDate = new Date(updatedData.date as any);
        } else {
            itemDate = new Date();
        }

        const matches = await findMatchesForLostItem({
            name: updatedData.name || 'Unknown Item',
            description: updatedData.description || '',
            tags: updatedData.tags,
            coordinates: updatedData.coordinates,
            date: itemDate,
            imageBase64: imageData,
        });

        // Build item data, excluding undefined values
        const itemData: Record<string, any> = {
            name: updatedData.name || 'Unknown Item',
            description: updatedData.description || '',
            type: 'Lost',
            status: 'Pending',
            location: updatedData.location || 'Unknown',
            date: Timestamp.fromDate(itemDate),
            tags: updatedData.tags || [],
            reportedBy: conversation.userId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Only add coordinates if defined
        if (updatedData.coordinates) {
            itemData.coordinates = updatedData.coordinates;
        }

        // Only add cloudinaryUrls if defined
        if ((updatedData as any).cloudinaryUrls) {
            itemData.cloudinaryUrls = (updatedData as any).cloudinaryUrls;
        }

        // Save the lost item to database
        await collections.items.add(itemData);

        // Mark conversation complete
        await updateConversation(conversation.id, { state: 'complete' });

        const matchMessage = matches.length > 0
            ? `🎉 Great news! I found ${matches.length} potential match${matches.length > 1 ? 'es' : ''} for your lost item!\n\n` +
            matches.slice(0, 3).map((m, i) =>
                `${i + 1}. **${m.item.name}** - ${m.score}% match\n   📍 ${m.item.location}`
            ).join('\n\n') +
            '\n\nWould you like to view these matches in detail?'
            : "I've recorded your lost item. I'll notify you if we find any matches!";

        await addMessage(conversation.id, {
            role: 'assistant',
            content: matchMessage,
            metadata: { chips: getGreetingMessage('idle').chips },
        });

        return {
            conversationId: conversation.id,
            message: matchMessage,
            state: 'complete',
            matches: matches.slice(0, 5),
            chips: getGreetingMessage('idle').chips,
            isComplete: true,
        };
    }

    // Add response message
    await addMessage(conversation.id, {
        role: 'assistant',
        content: question,
        metadata: { chips },
    });

    return {
        conversationId: conversation.id,
        message: question,
        state: nextState,
        chips,
        isComplete: false,
    };
}

/**
 * Handle "Report Found Item" flow
 */
async function handleReportFound(
    conversation: Conversation,
    message: string,
    imageData?: string,
    location?: { lat: number; lng: number },
    userId?: string
): Promise<ChatResponse> {
    // Extract data from message AND image if provided
    const { extracted } = await extractItemData(message, conversation.extractedData, 'report_found', imageData);

    const updatedData: Partial<ItemInput> = {
        ...conversation.extractedData,
        ...extracted,
    };

    if (location) {
        updatedData.coordinates = location;
        if (!updatedData.location) {
            updatedData.location = `Near (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;
        }
    }

    if (!updatedData.date) {
        updatedData.date = new Date();
    }

    // Handle image
    if (imageData) {
        try {
            const result = await uploadImage(imageData);
            (updatedData as any).cloudinaryUrls = [result.url];
        } catch (error) {
            console.error('Image upload failed:', error);
        }
    }

    const { question, nextState, chips } = getNextQuestion(
        conversation.state,
        updatedData,
        'report_found'
    );

    await updateConversation(conversation.id, {
        state: nextState,
        extractedData: updatedData,
    });

    // Save found item when confirmed
    if (nextState === 'search_matches') {
        // Ensure date is a proper Date object
        let itemDate: Date;
        if (updatedData.date instanceof Date) {
            itemDate = updatedData.date;
        } else if (updatedData.date) {
            itemDate = new Date(updatedData.date as any);
        } else {
            itemDate = new Date();
        }

        // Build item data, excluding undefined values
        const itemData: Record<string, any> = {
            name: updatedData.name || 'Unknown Item',
            description: updatedData.description || '',
            type: 'Found',
            status: 'Pending',
            location: updatedData.location || 'Unknown',
            date: Timestamp.fromDate(itemDate),
            tags: updatedData.tags || [],
            reportedBy: conversation.userId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Only add coordinates if defined
        if (updatedData.coordinates) {
            itemData.coordinates = updatedData.coordinates;
        }

        // Only add cloudinaryUrls if defined
        if ((updatedData as any).cloudinaryUrls) {
            itemData.cloudinaryUrls = (updatedData as any).cloudinaryUrls;
        }

        // Save to database
        const itemRef = await collections.items.add(itemData);

        // Award credits
        if (userId) {
            await awardFoundItemCredits(userId, itemRef.id);
        }

        // Search for potential owners
        const matches = await findMatchesForFoundItem({
            name: updatedData.name || 'Unknown Item',
            description: updatedData.description || '',
            tags: updatedData.tags,
            coordinates: updatedData.coordinates,
            date: updatedData.date || new Date(),
            imageBase64: imageData,
        });

        await updateConversation(conversation.id, { state: 'complete' });

        const successMessage = `✅ Thank you! The found item has been logged.\n\n🏆 **+${20} credits earned!**` +
            (matches.length > 0
                ? `\n\n📋 I found ${matches.length} potential owner${matches.length > 1 ? 's' : ''} - they'll be notified.`
                : '\n\n📋 No matching lost items yet. We\'ll notify potential owners if they report it.');

        await addMessage(conversation.id, {
            role: 'assistant',
            content: successMessage,
            metadata: { chips: getGreetingMessage('idle').chips },
        });

        return {
            conversationId: conversation.id,
            message: successMessage,
            state: 'complete',
            matches: matches.slice(0, 3),
            chips: getGreetingMessage('idle').chips,
            isComplete: true,
        };
    }

    await addMessage(conversation.id, {
        role: 'assistant',
        content: question,
        metadata: { chips },
    });

    return {
        conversationId: conversation.id,
        message: question,
        state: nextState,
        chips,
        isComplete: false,
    };
}

/**
 * Handle "Check Matches" flow
 */
async function handleCheckMatches(
    conversation: Conversation,
    userId: string
): Promise<ChatResponse> {
    // Get user's lost items
    const snapshot = await collections.items
        .where('reportedBy', '==', userId)
        .where('type', '==', 'Lost')
        .where('status', '==', 'Pending')
        .get();

    if (snapshot.empty) {
        const message = "You don't have any pending lost item reports. Would you like to report a lost item?";

        await addMessage(conversation.id, {
            role: 'assistant',
            content: message,
            metadata: { chips: [{ label: 'Report lost item', icon: '🔍' }] },
        });

        return {
            conversationId: conversation.id,
            message,
            state: 'complete',
            chips: [{ label: 'Report lost item', icon: '🔍' }],
            isComplete: true,
        };
    }

    // Check matches for each lost item
    const allMatches = [];
    for (const doc of snapshot.docs) {
        const item = doc.data();
        const matches = await findMatchesForLostItem({
            name: item.name,
            description: item.description,
            tags: item.tags,
            coordinates: item.coordinates,
            date: item.date.toDate(),
        });

        allMatches.push(...matches.map(m => ({ ...m, lostItemName: item.name })));
    }

    await updateConversation(conversation.id, { state: 'complete' });

    const message = allMatches.length > 0
        ? `🔍 I found ${allMatches.length} potential match${allMatches.length > 1 ? 'es' : ''} for your lost items:\n\n` +
        allMatches.slice(0, 5).map((m, i) =>
            `${i + 1}. **${m.item.name}** matches your "${(m as any).lostItemName}" - ${m.score}% match`
        ).join('\n')
        : "No matches found yet. I'll notify you when we find something!";

    await addMessage(conversation.id, {
        role: 'assistant',
        content: message,
        metadata: { chips: getGreetingMessage('idle').chips },
    });

    return {
        conversationId: conversation.id,
        message,
        state: 'complete',
        matches: allMatches.slice(0, 5),
        chips: getGreetingMessage('idle').chips,
        isComplete: true,
    };
}

/**
 * Handle "Find Collection Point" flow
 */
async function handleFindCollection(
    conversation: Conversation,
    message: string,
    location?: { lat: number; lng: number }
): Promise<ChatResponse> {
    // Get collection points from database
    const snapshot = await collections.collectionPoints.get();

    if (snapshot.empty) {
        const response = "No collection points have been configured yet. Please contact the administrator.";

        await addMessage(conversation.id, {
            role: 'assistant',
            content: response,
        });

        return {
            conversationId: conversation.id,
            message: response,
            state: 'complete',
            chips: getGreetingMessage('idle').chips,
            isComplete: true,
        };
    }

    // For now, list all collection points
    const points = snapshot.docs.map(doc => doc.data());
    const response = `📍 Here are the available collection points:\n\n` +
        points.map((p, i) =>
            `${i + 1}. **${p.name}**\n   📌 ${p.address}\n   🕐 ${p.hours || 'Contact for hours'}`
        ).join('\n\n');

    await updateConversation(conversation.id, { state: 'complete' });

    await addMessage(conversation.id, {
        role: 'assistant',
        content: response,
        metadata: { chips: getGreetingMessage('idle').chips },
    });

    return {
        conversationId: conversation.id,
        message: response,
        state: 'complete',
        chips: getGreetingMessage('idle').chips,
        isComplete: true,
    };
}

/**
 * Handle generic conversation
 */
async function handleGenericQuery(
    conversation: Conversation,
    message: string
): Promise<ChatResponse> {
    const response = await generateAIResponse(
        conversation.messages,
        conversation.context,
        conversation.state
    );

    await addMessage(conversation.id, {
        role: 'assistant',
        content: response,
        metadata: { chips: getGreetingMessage('idle').chips },
    });

    return {
        conversationId: conversation.id,
        message: response,
        state: conversation.state,
        chips: getGreetingMessage('idle').chips,
        isComplete: false,
    };
}

/**
 * Terminate conversation
 */
async function terminateConversation(conversationId: string, reason: string): Promise<void> {
    await updateConversation(conversationId, { state: 'terminated' });
    await addMessage(conversationId, {
        role: 'system',
        content: reason,
    });
}
