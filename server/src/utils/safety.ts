/**
 * Safety Guards for AI Agent
 * Prevents infinite loops, off-topic responses, and abuse
 */

import { SAFETY_LIMITS, ConversationState } from '../types/index.js';

export interface SafetyCheckResult {
    isValid: boolean;
    reason?: string;
    shouldTerminate?: boolean;
    newInvalidCount?: number;
}

/**
 * Check if conversation has exceeded turn limit
 */
export function checkTurnLimit(turnCount: number): SafetyCheckResult {
    if (turnCount >= SAFETY_LIMITS.MAX_TURNS_PER_CONVERSATION) {
        return {
            isValid: false,
            reason: 'Maximum conversation turns reached. Please start a new conversation.',
            shouldTerminate: true,
        };
    }
    return { isValid: true };
}

/**
 * Check if user has exceeded invalid attempts
 */
export function checkInvalidAttempts(
    invalidAttempts: number,
    currentAttemptValid: boolean
): SafetyCheckResult {
    const newCount = currentAttemptValid ? 0 : invalidAttempts + 1;

    if (newCount >= SAFETY_LIMITS.MAX_INVALID_ATTEMPTS) {
        return {
            isValid: false,
            reason: "I'm having trouble understanding your responses. Let's start fresh - please click one of the quick action buttons below.",
            shouldTerminate: true,
            newInvalidCount: newCount,
        };
    }

    return {
        isValid: true,
        newInvalidCount: newCount,
    };
}

/**
 * Check if conversation has timed out
 */
export function checkSessionTimeout(lastActivityTime: Date): SafetyCheckResult {
    const now = new Date();
    const diffMinutes = (now.getTime() - lastActivityTime.getTime()) / (1000 * 60);

    if (diffMinutes >= SAFETY_LIMITS.SESSION_TIMEOUT_MINUTES) {
        return {
            isValid: false,
            reason: 'Your session has timed out. Please start a new conversation.',
            shouldTerminate: true,
        };
    }

    return { isValid: true };
}

/**
 * System prompt to keep AI focused on lost/found context
 */
export const SYSTEM_PROMPT = `You are ReClaim AI Assistant, a helpful bot for a lost and found platform.

STRICT RULES:
1. ONLY discuss topics related to lost items, found items, item descriptions, locations, and the claiming process.
2. If a user asks about anything unrelated (politics, coding, general knowledge, etc.), politely redirect them to the lost and found topic.
3. Never generate harmful, inappropriate, or off-topic content.
4. Always be concise and helpful.
5. When collecting item information, ask one question at a time.
6. Extract specific details: item name, color, brand, size, distinctive features, location, date/time.

RESPONSE FORMAT:
- Keep responses under 100 words unless providing match results.
- Use a friendly, professional tone.
- If you need more information, ask a clear, specific question.

CONTEXT-SPECIFIC BEHAVIOR:
- "report_lost": Help user describe their lost item to find matches
- "report_found": Collect details about a found item to log it in the system
- "check_matches": Show the user their potential item matches
- "find_collection": Help user locate the nearest collection point`;

/**
 * Validate if user message is relevant to the current context
 */
export async function validateUserInput(
    userMessage: string,
    context: string
): Promise<{ isValid: boolean; extractedIntent?: string }> {
    // Basic keyword matching for quick validation
    const lostFoundKeywords = [
        'lost', 'found', 'missing', 'item', 'bag', 'phone', 'wallet', 'keys', 'laptop',
        'watch', 'glasses', 'umbrella', 'book', 'bottle', 'headphones', 'earbuds',
        'charger', 'id', 'card', 'document', 'clothes', 'jacket', 'shoe', 'backpack',
        'purse', 'camera', 'tablet', 'yesterday', 'today', 'morning', 'afternoon',
        'evening', 'library', 'cafeteria', 'gym', 'classroom', 'building', 'floor',
        'room', 'black', 'white', 'red', 'blue', 'green', 'brown', 'silver', 'gold',
        'yes', 'no', 'correct', 'wrong', 'here', 'there', 'that', 'this', 'my', 'i',
        'help', 'find', 'search', 'match', 'claim', 'collect', 'pickup', 'location',
        'where', 'when', 'what', 'description', 'color', 'brand', 'size', 'photo', 'image'
    ];

    const messageLower = userMessage.toLowerCase();
    const hasRelevantKeyword = lostFoundKeywords.some(keyword =>
        messageLower.includes(keyword)
    );

    // Allow short responses (yes/no/ok) as they're likely answers to questions
    const isShortResponse = userMessage.trim().length < 20;

    return {
        isValid: hasRelevantKeyword || isShortResponse,
        extractedIntent: hasRelevantKeyword ? context : undefined,
    };
}

/**
 * Generate warning message for invalid input
 */
export function getInvalidInputWarning(attemptNumber: number): string {
    const warnings = [
        "I didn't quite catch that. Could you please describe your item or answer my question?",
        "I'm here to help with lost and found items. Please provide details about your item.",
        "Last attempt: Please focus on describing your lost/found item, or I'll need to end this conversation.",
    ];

    return warnings[Math.min(attemptNumber - 1, warnings.length - 1)];
}
