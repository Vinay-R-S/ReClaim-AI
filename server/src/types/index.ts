import { Timestamp } from 'firebase-admin/firestore';

// ============ User Types ============
export interface User {
    uid: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    role: 'user' | 'admin';
    status: 'active' | 'blocked';
    credits: number;
    createdAt?: Timestamp;
    lastLoginAt?: Timestamp;
}

// ============ Item Types ============
export type ItemType = 'Lost' | 'Found';
export type ItemStatus = 'Pending' | 'Matched' | 'Claimed' | 'Closed';

export interface Coordinates {
    lat: number;
    lng: number;
}

export interface Item {
    id: string;
    name: string;
    description: string;
    type: ItemType;
    status: ItemStatus;
    location: string;
    coordinates?: Coordinates;
    date: Timestamp | Date;
    tags?: string[];
    imageUrl?: string;
    cloudinaryUrls?: string[];
    matchScore?: number;
    reportedBy: string; // User ID
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

export interface ItemInput {
    name: string;
    description: string;
    type: ItemType;
    location: string;
    coordinates?: Coordinates;
    date: Date;
    tags?: string[];
    images?: File[] | string[]; // Files or base64/urls
    reportedBy: string;
}

// ============ Conversation Types ============
export type ConversationContext =
    | 'report_lost'
    | 'report_found'
    | 'check_matches'
    | 'find_collection'
    | 'idle';

export type ConversationState =
    | 'idle'
    | 'ask_description'
    | 'ask_location'
    | 'ask_datetime'
    | 'ask_image'
    | 'confirm_details'
    | 'search_matches'
    | 'show_results'
    | 'complete'
    | 'terminated';

export interface Message {
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

export interface Conversation {
    id: string;
    userId: string;
    context: ConversationContext;
    state: ConversationState;
    messages: Message[];
    extractedData: Partial<ItemInput>;
    invalidAttempts: number;
    turnCount: number;
    createdAt: Timestamp;
    expiresAt: Timestamp; // TTL: 7 days
}

// ============ Matching Types ============
export interface MatchResult {
    itemId: string;
    item: Item;
    score: number;
    breakdown: {
        textScore: number;
        locationScore: number;
        timeScore: number;
        imageScore: number;
    };
}

// ============ Credit Types ============
export interface CreditTransaction {
    id: string;
    userId: string;
    amount: number;
    reason: 'report_found' | 'successful_match_finder' | 'successful_match_owner' | 'false_claim';
    relatedItemId?: string;
    createdAt: Timestamp;
}

// ============ API Types ============
export interface ChatRequest {
    conversationId?: string;
    message: string;
    context?: ConversationContext;
    imageData?: string; // Base64
    location?: Coordinates;
}

export interface ChatResponse {
    conversationId: string;
    message: string;
    state: ConversationState;
    chips?: { label: string; icon?: string }[];
    matches?: MatchResult[];
    isComplete: boolean;
}

// ============ Safety Constants ============
export const SAFETY_LIMITS = {
    MAX_INVALID_ATTEMPTS: 3,
    MAX_TURNS_PER_CONVERSATION: 15,
    SESSION_TIMEOUT_MINUTES: 5,
    CHAT_HISTORY_TTL_DAYS: 7,
    MATCH_THRESHOLD_PERCENT: 70,
    LOCATION_RADIUS_KM: 2,
} as const;

// ============ Credit Constants ============
export const CREDIT_VALUES = {
    REPORT_FOUND: 20,
    SUCCESSFUL_MATCH_FINDER: 50,
    SUCCESSFUL_MATCH_OWNER: 10,
    FALSE_CLAIM: -30,
} as const;
