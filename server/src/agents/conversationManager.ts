/**
 * Conversation Manager - State machine for chat interactions
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import { callLLM, parseJSONFromLLM } from '../utils/llm.js';
import { SYSTEM_PROMPT, checkTurnLimit, checkInvalidAttempts, validateUserInput, getInvalidInputWarning } from '../utils/safety.js';
import {
    Conversation,
    ConversationContext,
    ConversationState,
    Message,
    ItemInput,
    SAFETY_LIMITS,
    ChatRequest,
    ChatResponse,
} from '../types/index.js';

/**
 * Create a new conversation
 */
export async function createConversation(
    userId: string,
    context: ConversationContext
): Promise<Conversation> {
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
        now.toMillis() + SAFETY_LIMITS.CHAT_HISTORY_TTL_DAYS * 24 * 60 * 60 * 1000
    );

    const conversation: Omit<Conversation, 'id'> = {
        userId,
        context,
        state: getInitialState(context),
        messages: [],
        extractedData: {},
        invalidAttempts: 0,
        turnCount: 0,
        createdAt: now,
        expiresAt,
    };

    const docRef = await collections.conversations.add(conversation);

    return {
        id: docRef.id,
        ...conversation,
    };
}

/**
 * Get initial state based on context
 */
function getInitialState(context: ConversationContext): ConversationState {
    switch (context) {
        case 'report_lost':
        case 'report_found':
            return 'ask_description';
        case 'check_matches':
            return 'search_matches';
        case 'find_collection':
            return 'ask_location';
        default:
            return 'idle';
    }
}

/**
 * Get conversation by ID
 */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
    const doc = await collections.conversations.doc(conversationId).get();
    if (!doc.exists) return null;

    return {
        id: doc.id,
        ...doc.data(),
    } as Conversation;
}

/**
 * Get or create conversation for a user
 */
export async function getOrCreateConversation(
    userId: string,
    context: ConversationContext,
    conversationId?: string
): Promise<Conversation> {
    // If conversationId provided, try to get it
    if (conversationId) {
        const existing = await getConversation(conversationId);
        if (existing && existing.userId === userId && existing.state !== 'terminated' && existing.state !== 'complete') {
            return existing;
        }
    }

    // Create new conversation
    return createConversation(userId, context);
}

/**
 * Update conversation state
 */
export async function updateConversation(
    conversationId: string,
    updates: Partial<Pick<Conversation, 'state' | 'extractedData' | 'invalidAttempts' | 'turnCount'>>
): Promise<void> {
    await collections.conversations.doc(conversationId).update(updates);
}

/**
 * Add message to conversation
 */
export async function addMessage(
    conversationId: string,
    message: Omit<Message, 'id' | 'timestamp'>
): Promise<Message> {
    // Build message object, filtering out undefined values
    // Firestore's arrayUnion cannot handle undefined values
    const fullMessage: Message = {
        id: `msg_${Date.now()}`,
        role: message.role,
        content: message.content,
        timestamp: new Date(),
    };

    // Only add metadata if it exists and has values
    if (message.metadata && Object.keys(message.metadata).length > 0) {
        // Filter out undefined values from metadata
        const cleanMetadata: Record<string, any> = {};
        for (const [key, value] of Object.entries(message.metadata)) {
            if (value !== undefined) {
                cleanMetadata[key] = value;
            }
        }
        if (Object.keys(cleanMetadata).length > 0) {
            fullMessage.metadata = cleanMetadata;
        }
    }

    await collections.conversations.doc(conversationId).update({
        messages: FieldValue.arrayUnion(fullMessage),
        turnCount: FieldValue.increment(1),
    });

    return fullMessage;
}

/**
 * Get greeting message for context
 */
export function getGreetingMessage(context: ConversationContext): { content: string; chips?: { label: string; icon?: string }[] } {
    switch (context) {
        case 'report_lost':
            return {
                content: "I'll help you report your lost item. Can you describe what you lost? Include details like the item type, color, brand, and any distinctive features.",
                chips: [
                    { label: 'Add photo', icon: '📷' },
                ],
            };
        case 'report_found':
            return {
                content: "Thank you for reporting a found item! Please describe the item you found, including its color, brand, size, and any distinguishing features.",
                chips: [
                    { label: 'Add photo', icon: '📷' },
                ],
            };
        case 'check_matches':
            return {
                content: "I'll check for potential matches. Let me search through our database...",
            };
        case 'find_collection':
            return {
                content: "I'll help you find the nearest collection point. Can you share your current location or tell me which area you're in?",
                chips: [
                    { label: 'Share location', icon: '📍' },
                ],
            };
        default:
            return {
                content: "Hello! I'm your ReClaim assistant. How can I help you today?",
                chips: [
                    { label: 'Report lost item', icon: '🔍' },
                    { label: 'Report found item', icon: '📦' },
                    { label: 'Check matches', icon: '🔔' },
                    { label: 'Find collection point', icon: '📍' },
                ],
            };
    }
}

/**
 * Extract item data from user message AND/OR image using LLM
 */
export async function extractItemData(
    message: string,
    currentData: Partial<ItemInput>,
    context: ConversationContext,
    imageBase64?: string
): Promise<{ extracted: Partial<ItemInput>; confidence: number }> {
    // Build prompt based on whether we have an image
    const hasImage = !!imageBase64;

    const prompt = hasImage
        ? `You are analyzing an image of a ${context === 'report_lost' ? 'lost' : 'found'} item along with user text.

ANALYZE THE IMAGE CAREFULLY and extract ALL visible details about the item.

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

Current collected data: ${JSON.stringify(currentData)}

User message: "${message}"

Extract and return ONLY new/updated information in JSON format:
{
  "name": "item name if mentioned",
  "description": "item description if mentioned", 
  "color": "color if mentioned",
  "brand": "brand if mentioned",
  "size": "size if mentioned",
  "tags": ["array", "of", "features"],
  "location": "location if mentioned",
  "date": "date/time if mentioned (ISO format or null)",
  "confidence": 0.0-1.0 (how confident you are in the extraction)
}

Only include fields that have actual values from the message. Don't invent or assume information.`;

    try {
        const response = await callLLM([
            {
                role: 'system', content: hasImage
                    ? 'You are a vision AI that analyzes images of items for a lost and found system. Be detailed and thorough in identifying the item.'
                    : 'You are a data extraction assistant. Extract only factual information from user messages.'
            },
            { role: 'user', content: prompt },
        ], {
            temperature: 0.1,
            imageBase64: imageBase64,
            imageMimeType: 'image/jpeg'
        });

        console.log('LLM extraction response:', response.content);

        const result = parseJSONFromLLM<any>(response.content);

        if (!result) {
            console.error('Failed to parse LLM response as JSON');
            return { extracted: {}, confidence: 0 };
        }

        const confidence = result.confidence || (hasImage ? 0.8 : 0.5);
        delete result.confidence;

        // Build extracted data
        const extracted: Partial<ItemInput> = {};

        if (result.name) {
            extracted.name = result.name;
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
        if (result.location) {
            extracted.location = result.location;
        }
        if (result.date) {
            try {
                extracted.date = new Date(result.date);
            } catch {
                // Ignore invalid date
            }
        }

        console.log('Extracted data:', extracted);
        return { extracted, confidence };
    } catch (error) {
        console.error('Data extraction failed:', error);
        return { extracted: {}, confidence: 0 };
    }
}

/**
 * Get next question based on current state and collected data
 * Smart state machine that advances based on what's already collected
 */
export function getNextQuestion(
    state: ConversationState,
    collectedData: Partial<ItemInput>,
    context: ConversationContext
): { question: string; nextState: ConversationState; chips?: { label: string; icon?: string }[] } {
    // Check what we already have
    const hasName = !!collectedData.name;
    const hasDescription = !!collectedData.description;
    const hasLocation = !!collectedData.location || !!collectedData.coordinates;
    const hasDate = !!collectedData.date;
    const hasImage = !!(collectedData as any).cloudinaryUrls?.length;

    // Build a summary of what we know
    const knownItems: string[] = [];
    if (hasName) knownItems.push(`**${collectedData.name}**`);
    if (hasDescription) knownItems.push(collectedData.description!.substring(0, 100) + (collectedData.description!.length > 100 ? '...' : ''));

    switch (state) {
        case 'ask_description':
            // If we have name AND description (likely from image), move to location
            if (hasName && hasDescription) {
                // Check if we also have location already
                if (hasLocation) {
                    if (hasDate) {
                        // We have everything, go to confirmation
                        return {
                            question: formatConfirmation(collectedData, context),
                            nextState: 'confirm_details',
                            chips: [
                                { label: 'Confirm', icon: '✅' },
                                { label: 'Edit details', icon: '✏️' },
                            ],
                        };
                    }
                    return {
                        question: `Great! I identified: ${collectedData.name}${hasLocation ? ` at ${collectedData.location}` : ''}.\n\nWhen did this happen?`,
                        nextState: 'ask_datetime',
                    };
                }
                return {
                    question: `I identified: **${collectedData.name}**\n${hasDescription ? `📝 ${collectedData.description!.substring(0, 150)}` : ''}\n\nWhere did you ${context === 'report_lost' ? 'last see it' : 'find it'}?`,
                    nextState: 'ask_location',
                    chips: [{ label: 'Share location', icon: '📍' }],
                };
            }
            return {
                question: 'Can you describe the item? Include details like type, color, brand, and any distinguishing features.',
                nextState: 'ask_description',
                chips: [{ label: 'Add photo', icon: '📷' }],
            };

        case 'ask_location':
            if (hasLocation) {
                if (hasDate) {
                    // Skip to confirmation
                    return {
                        question: formatConfirmation(collectedData, context),
                        nextState: 'confirm_details',
                        chips: [
                            { label: 'Confirm', icon: '✅' },
                            { label: 'Edit details', icon: '✏️' },
                        ],
                    };
                }
                return {
                    question: `Got it - ${collectedData.location}. When did this happen? (e.g., "today at 5pm", "yesterday afternoon")`,
                    nextState: 'ask_datetime',
                };
            }
            return {
                question: 'Where did you ' + (context === 'report_lost' ? 'last see' : 'find') + ' this item? (building, area, or address)',
                nextState: 'ask_location',
                chips: [{ label: 'Share location', icon: '📍' }],
            };

        case 'ask_datetime':
            if (hasDate) {
                // We have everything, go to confirmation
                return {
                    question: formatConfirmation(collectedData, context),
                    nextState: 'confirm_details',
                    chips: [
                        { label: 'Confirm', icon: '✅' },
                        { label: 'Edit details', icon: '✏️' },
                    ],
                };
            }
            return {
                question: 'Do you remember approximately when this happened? (date and time)',
                nextState: 'ask_datetime',
            };

        case 'ask_image':
            return {
                question: formatConfirmation(collectedData, context),
                nextState: 'confirm_details',
                chips: [
                    { label: 'Confirm', icon: '✅' },
                    { label: 'Edit details', icon: '✏️' },
                ],
            };

        case 'confirm_details':
            return {
                question: 'Perfect! Let me search for potential matches...',
                nextState: 'search_matches',
            };

        default:
            return {
                question: 'Is there anything else I can help you with?',
                nextState: 'idle',
                chips: [
                    { label: 'Report lost item', icon: '🔍' },
                    { label: 'Report found item', icon: '📦' },
                ],
            };
    }
}

/**
 * Format confirmation message
 */
function formatConfirmation(data: Partial<ItemInput>, context: ConversationContext): string {
    const action = context === 'report_lost' ? 'lost' : 'found';

    // Format date safely
    let dateStr = '';
    if (data.date) {
        try {
            // Handle both Date objects and Firestore Timestamps
            const dateObj = data.date instanceof Date
                ? data.date
                : (data.date as any).toDate?.()
                    ? (data.date as any).toDate()
                    : new Date(data.date as any);
            dateStr = dateObj.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            dateStr = String(data.date);
        }
    }

    const parts = [
        `Here's what I have for your ${action} item report:`,
        '',
        `📦 **Item:** ${data.name || 'Unknown'}`,
        data.description && `📝 **Description:** ${data.description.substring(0, 200)}${data.description.length > 200 ? '...' : ''}`,
        data.location && `📍 **Location:** ${data.location}`,
        dateStr && `📅 **Date/Time:** ${dateStr}`,
        data.tags?.length && `🏷️ **Tags:** ${data.tags.join(', ')}`,
        (data as any).cloudinaryUrls?.length && `🖼️ **Image:** Uploaded`,
        '',
        'Does this look correct?',
    ];

    return parts.filter(Boolean).join('\n');
}

/**
 * Generate AI response for complex queries
 */
export async function generateAIResponse(
    messages: Message[],
    context: ConversationContext,
    currentState: ConversationState
): Promise<string> {
    const systemMessage = `${SYSTEM_PROMPT}

Current context: ${context}
Current state: ${currentState}

Keep your response concise (under 100 words). Ask one question at a time when collecting information.`;

    const formattedMessages = messages
        .filter(m => m.role !== 'system' && m.content) // Filter out system messages and empty content
        .slice(-5)
        .map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

    // Safeguard: if no valid messages, return a default response
    if (formattedMessages.length === 0) {
        return "How can I help you today? You can report a lost item, report a found item, check for matches, or find a collection point.";
    }

    const response = await callLLM([
        { role: 'system', content: systemMessage },
        ...formattedMessages,
    ], { temperature: 0.5, maxTokens: 300 });

    return response.content;
}
