/**
 * AI Agent Service - Orchestrates the chat interaction using LangGraph
 * 
 * This service acts as a bridge between the chat API routes and the
 * LangGraph workflow. It manages conversation state persistence and
 * invokes the appropriate graph flow.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import { reportFlowGraph, ReportFlowState, ConversationContext, SAFETY_LIMITS } from '../graph/index.js';
import type { ChatRequest, ChatResponse, Conversation, Message, ConversationState, ItemInput } from '../types/index.js';

/**
 * Process a chat message using LangGraph workflow
 */
export async function processChat(
    userId: string,
    request: ChatRequest
): Promise<ChatResponse> {
    const { conversationId, message, context, imageData, location } = request;

    console.log('[processChat] Processing for user:', userId, 'context:', context, 'message:', message?.substring(0, 50));

    // Get or create conversation
    const conversation = await getOrCreateConversation(
        userId,
        context || 'idle',
        conversationId
    );

    // Check safety limits
    if (conversation.turnCount >= SAFETY_LIMITS.MAX_TURNS_PER_CONVERSATION) {
        await terminateConversation(conversation.id, 'Maximum conversation turns reached. Please start a new conversation.');
        return {
            conversationId: conversation.id,
            message: 'Maximum conversation turns reached. Please start a new conversation.',
            state: 'terminated',
            chips: getIdleChips(),
            isComplete: true,
        };
    }

    // Build initial state for the graph
    const initialState: Partial<ReportFlowState> = {
        conversationId: conversation.id,
        userId,
        context: conversation.context as ConversationContext,
        itemData: conversation.extractedData || {},
        pendingMatch: conversation.pendingMatch,
        pendingLostItemId: conversation.pendingLostItemId,
        currentNode: conversation.state === 'idle' || conversation.turnCount === 0 ? 'greet' : getNodeFromState(conversation.state),
        turnCount: conversation.turnCount,
        invalidAttempts: conversation.invalidAttempts,
        lastUserMessage: message || '',
        imageBase64: imageData,
        isComplete: false,
    };

    // Add location to item data if provided
    if (location) {
        initialState.itemData = {
            ...initialState.itemData,
            coordinates: location,
            location: initialState.itemData?.location || `Near (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`,
        };
    }

    try {
        // If this is a new conversation, just run the greet node
        if (conversation.turnCount === 0 && context && context !== 'idle') {
            console.log('[processChat] Starting new conversation with context:', context);

            // Invoke the graph starting from greet
            const result = await reportFlowGraph.invoke(initialState);

            // Save the initial state
            await updateConversation(conversation.id, {
                state: mapNodeToState(result.currentNode),
                extractedData: result.itemData,
                pendingMatch: result.pendingMatch,
                pendingLostItemId: result.pendingLostItemId,
                turnCount: result.turnCount,
            });

            // Add assistant message
            await addMessage(conversation.id, {
                role: 'assistant',
                content: result.responseMessage,
                metadata: { chips: result.responseChips },
            });

            return {
                conversationId: conversation.id,
                message: result.responseMessage,
                state: mapNodeToState(result.currentNode),
                chips: result.responseChips,
                matches: result.matches,
                isComplete: result.isComplete,
            };
        }

        // Add user message to history
        if (message) {
            await addMessage(conversation.id, {
                role: 'user',
                content: message,
                metadata: location ? { location } : undefined,
            });
        }

        // Invoke the graph with current state
        console.log('[processChat] Invoking graph with state:', initialState.currentNode);
        const result = await reportFlowGraph.invoke(initialState);

        // Update conversation state
        await updateConversation(conversation.id, {
            state: mapNodeToState(result.currentNode),
            extractedData: result.itemData,
            pendingMatch: result.pendingMatch,
            pendingLostItemId: result.pendingLostItemId,
            turnCount: result.turnCount,
            invalidAttempts: result.invalidAttempts,
        });

        // Add assistant response to history
        await addMessage(conversation.id, {
            role: 'assistant',
            content: result.responseMessage,
            metadata: { chips: result.responseChips },
        });

        // If complete, mark conversation as complete
        if (result.isComplete) {
            await updateConversation(conversation.id, { state: 'complete' });
        }

        return {
            conversationId: conversation.id,
            message: result.responseMessage,
            state: mapNodeToState(result.currentNode),
            chips: result.responseChips,
            matches: result.matches,
            isComplete: result.isComplete,
        };

    } catch (error) {
        console.error('[processChat] Graph execution error:', error);

        // Return error response
        const errorMessage = 'Sorry, something went wrong. Please try again.';
        await addMessage(conversation.id, {
            role: 'assistant',
            content: errorMessage,
        });

        return {
            conversationId: conversation.id,
            message: errorMessage,
            state: 'idle',
            chips: getIdleChips(),
            isComplete: false,
        };
    }
}

// ============ Helper Functions ============

/**
 * Get or create a conversation
 */
async function getOrCreateConversation(
    userId: string,
    context: string,
    conversationId?: string
): Promise<Conversation> {
    if (conversationId) {
        const doc = await collections.conversations.doc(conversationId).get();
        if (doc.exists) {
            const data = doc.data()!;
            if (data.userId === userId && data.state !== 'terminated' && data.state !== 'complete') {
                return { id: doc.id, ...data } as Conversation;
            } else {
                console.log(`[getOrCreateConversation] Found doc ${doc.id} but mismatch. User: ${data.userId} vs ${userId}, State: ${data.state}`);
            }
        } else {
            console.log(`[getOrCreateConversation] Doc ${conversationId} does not exist`);
        }
    } else {
        console.log(`[getOrCreateConversation] No conversationId provided, creating new`);
    }

    // Create new conversation
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
        now.toMillis() + SAFETY_LIMITS.CHAT_HISTORY_TTL_DAYS * 24 * 60 * 60 * 1000
    );

    const conversation = {
        userId,
        context,
        state: 'idle',
        messages: [],
        extractedData: {},
        invalidAttempts: 0,
        turnCount: 0,
        createdAt: now,
        expiresAt,
    };

    const docRef = await collections.conversations.add(conversation);
    return { id: docRef.id, ...conversation } as Conversation;
}

/**
 * Update conversation state
 */
async function updateConversation(
    conversationId: string,
    updates: Partial<Pick<Conversation, 'state' | 'extractedData' | 'invalidAttempts' | 'turnCount' | 'pendingMatch' | 'pendingLostItemId'>>
): Promise<void> {
    // Sanitize extractedData to remove invalid values that Firestore can't handle
    if (updates.extractedData) {
        const sanitized = { ...updates.extractedData };

        // Handle invalid dates
        if (sanitized.date) {
            const dateValue = sanitized.date instanceof Date ? sanitized.date : new Date(sanitized.date as any);
            if (isNaN(dateValue.getTime())) {
                delete sanitized.date; // Remove invalid date
            } else {
                sanitized.date = dateValue;
            }
        }

        // Remove "None" or empty location values
        if (sanitized.location === 'None' || sanitized.location === 'none' || sanitized.location === '') {
            delete sanitized.location;
        }

        // Remove undefined values (Firestore doesn't accept undefined)
        Object.keys(sanitized).forEach(key => {
            if ((sanitized as any)[key] === undefined) {
                delete (sanitized as any)[key];
            }
        });

        updates = { ...updates, extractedData: sanitized };
    }

    await collections.conversations.doc(conversationId).update(updates);
}

/**
 * Add message to conversation
 */
async function addMessage(
    conversationId: string,
    message: Omit<Message, 'id' | 'timestamp'>
): Promise<void> {
    const fullMessage = {
        id: `msg_${Date.now()}`,
        role: message.role,
        content: message.content,
        timestamp: new Date(),
        ...(message.metadata && Object.keys(message.metadata).length > 0 ? { metadata: message.metadata } : {}),
    };

    await collections.conversations.doc(conversationId).update({
        messages: FieldValue.arrayUnion(fullMessage),
    });
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

/**
 * Map graph node to conversation state
 */
function mapNodeToState(node: string): ConversationState {
    const nodeStateMap: Record<string, ConversationState> = {
        greet: 'idle',
        collectDescription: 'ask_description',
        collectLocation: 'ask_location',
        collectDateTime: 'ask_datetime',
        confirmDetails: 'confirm_details',
        handleConfirmation: 'match_confirmation',
        saveItem: 'search_matches',
        searchMatches: 'search_matches',
        showResults: 'complete',
        checkMatches: 'complete',
        findCollection: 'complete',
        handleError: 'terminated',
        complete: 'complete',
    };

    return nodeStateMap[node] || 'idle' as ConversationState;
}

/**
 * Get node from conversation state
 */
function getNodeFromState(state: string): any {
    const stateNodeMap: Record<string, string> = {
        idle: 'greet',
        ask_description: 'collectDescription',
        ask_location: 'collectLocation',
        ask_datetime: 'collectDateTime',
        confirm_details: 'confirmDetails',
        match_confirmation: 'handleConfirmation',
        search_matches: 'searchMatches',
        complete: 'complete',
        terminated: 'handleError',
    };

    return stateNodeMap[state] || 'greet';
}

/**
 * Get default idle chips
 */
function getIdleChips() {
    return [
        { label: 'Report lost item' },
        { label: 'Report found item' },
        { label: 'Check matches' },
        { label: 'Find collection point' },
    ];
}
