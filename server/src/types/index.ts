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
    // Item submission counts
    lostItemsCount?: number;
    foundItemsCount?: number;
    totalItemsCount?: number;
}

// ============ Item Types ============
export type ItemType = 'Lost' | 'Found';
export type ItemStatus = 'Pending' | 'Matched' | 'Claimed' | 'Resolved';

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
    color?: string; // Color of the item for matching
    category?: string; // Electronics, Documents, Accessories, etc.
    imageUrl?: string;
    cloudinaryUrls?: string[];
    embedding?: number[];
    matchScore?: number;
    reportedBy: string; // User ID
    reportedByEmail?: string; // For notifications
    matchedItemId?: string; // ID of matched item
    matchedUserId?: string; // User who claimed
    verificationRequired?: boolean;
    verificationConfidence?: number;
    verifiedAt?: Timestamp;
    collectionPoint?: string;
    collectionInstructions?: string;
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
    color?: string;
    category?: string;
    images?: File[] | string[]; // Files or base64/urls
    reportedBy: string;
    reporterEmail?: string;       // Email of reporter
    collectionLocation?: string;  // For Found items - where to collect
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
    | 'match_confirmation'
    | 'show_results'
    | 'complete'
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
    pendingMatch?: MatchResult;
    pendingLostItemId?: string;
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
        tagScore: number;
        descriptionScore: number;
        colorScore: number;
        locationScore: number;
        timeScore: number;
        imageScore: number;
    };
}

export interface Match {
    id: string;
    lostItemId: string;
    foundItemId: string;
    // Comprehensive scoring breakdown (100 points total)
    tagScore: number;          // 0-30 points from tag matching
    descriptionScore: number;  // 0-20 points from description similarity
    colorScore: number;        // 0-15 points from color matching
    locationScore: number;     // 0-20 points from location proximity
    timeScore: number;         // 0-10 points from time window
    imageScore: number;        // 0-5 points from image analysis (optional)
    matchScore: number;        // Total: sum of all scores
    status: 'matched';
    createdAt: Timestamp;
    updatedAt?: Timestamp;
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

// ============ Verification Types ============
export interface VerificationQuestion {
    question: string;
    expectedAnswer?: string; // From item attributes
    userAnswer?: string;
    score?: number; // 0-100
}

export interface Verification {
    id: string;
    itemId: string; // Found item being verified
    claimantUserId: string; // User claiming the item
    claimantEmail: string;
    questions: VerificationQuestion[];
    confidenceScore: number; // Weighted average
    status: 'pending' | 'passed' | 'failed';
    createdAt: Timestamp;
    completedAt?: Timestamp;
}

// ============ API Types ============
export interface ChatRequest {
    conversationId?: string;
    message: string;
    context?: ConversationContext;
    imageData?: string | string[]; // Base64 - single image or array
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
    MATCH_THRESHOLD_PERCENT: 75,  // Restored to 75%
    LOCATION_RADIUS_KM: 10,        // Maximum distance for matching (km)
    TIME_WINDOW_HOURS: 72,         // Maximum time difference (hours)
} as const;

// ============ Credit Constants ============
export const CREDIT_VALUES = {
    REPORT_FOUND: 20,
    SUCCESSFUL_MATCH_FINDER: 50,
    SUCCESSFUL_MATCH_OWNER: 10,
    FALSE_CLAIM: -30,
} as const;
