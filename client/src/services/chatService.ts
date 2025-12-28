/**
 * Chat Service - Communicate with backend chat API
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export type ConversationContext =
    | 'report_lost'
    | 'report_found'
    | 'check_matches'
    | 'find_collection'
    | 'idle';

export interface Coordinates {
    lat: number;
    lng: number;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    metadata?: {
        chips?: { label: string; icon?: string }[];
        imageUrls?: string[];
        location?: Coordinates;
    };
}

export interface MatchResult {
    itemId: string;
    item: {
        id: string;
        name: string;
        description: string;
        location: string;
        imageUrl?: string;
        cloudinaryUrls?: string[];
    };
    score: number;
    breakdown: {
        textScore: number;
        locationScore: number;
        timeScore: number;
        imageScore: number;
    };
}

export interface ChatResponse {
    conversationId: string;
    message: string;
    state: string;
    chips?: { label: string; icon?: string }[];
    matches?: MatchResult[];
    isComplete: boolean;
}

/**
 * Start a new conversation with context
 */
export async function startConversation(
    userId: string,
    context: ConversationContext
): Promise<ChatResponse> {
    const response = await fetch(`${API_BASE_URL}/api/chat/start`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, context }),
    });

    if (!response.ok) {
        throw new Error('Failed to start conversation');
    }

    return response.json();
}

/**
 * Send a message in a conversation
 */
export async function sendMessage(
    userId: string,
    message: string,
    options?: {
        conversationId?: string;
        context?: ConversationContext;
        imageData?: string;
        location?: Coordinates;
    }
): Promise<ChatResponse> {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            userId,
            message,
            conversationId: options?.conversationId,
            context: options?.context,
            imageData: options?.imageData,
            location: options?.location,
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to send message');
    }

    return response.json();
}

/**
 * Get chat history for a user
 */
export async function getChatHistory(
    userId: string,
    limit: number = 10
): Promise<{ conversations: any[] }> {
    const response = await fetch(
        `${API_BASE_URL}/api/chat/history/${userId}?limit=${limit}`,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error('Failed to get chat history');
    }

    return response.json();
}

/**
 * Get user credits
 */
export async function getUserCredits(
    userId: string
): Promise<{ credits: number; history: any[] }> {
    const response = await fetch(
        `${API_BASE_URL}/api/notifications/credits/${userId}`,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error('Failed to get credits');
    }

    return response.json();
}

/**
 * Convert file to base64
 */
export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data:image/...;base64, prefix
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = (error) => reject(error);
    });
}
