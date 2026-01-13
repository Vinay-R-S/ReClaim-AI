/**
 * LangGraph State Types for ReClaim AI Agent
 * Defines the state annotations and types for the conversation flow
 */

import { Annotation } from '@langchain/langgraph';
// Import types from main types file to ensure compatibility
import type { MatchResult, Coordinates as MainCoordinates } from '../types/index.js';

// Re-export for convenience
export type { MatchResult };

/**
 * Coordinates for location tracking
 */
export interface Coordinates {
    lat: number;
    lng: number;
}

/**
 * Item data collected during conversation
 */
export interface CollectedItemData {
    name?: string;
    description?: string;
    location?: string;
    coordinates?: Coordinates;
    date?: Date;
    tags?: string[];
    color?: string;
    imageUrls?: string[];
    cloudinaryUrls?: string[];
}

/**
 * Response chip for quick actions
 */
export interface ResponseChip {
    label: string;
    icon?: string;
}

/**
 * Conversation context types
 */
export type ConversationContext =
    | 'report_lost'
    | 'report_found'
    | 'check_matches'
    | 'find_collection'
    | 'idle';

/**
 * Node names in the graph
 */
export type GraphNode =
    | 'greet'
    | 'collectDescription'
    | 'extractData'
    | 'collectLocation'
    | 'collectDateTime'
    | 'confirmDetails'
    | 'handleConfirmation'
    | 'saveItem'
    | 'searchMatches'
    | 'showResults'
    | 'preSearchResults'
    | 'handleError'
    | 'complete';

/**
 * LangGraph State Annotation
 * Defines the structure of state that flows through the graph
 */
export const ReportFlowAnnotation = Annotation.Root({
    // Conversation tracking
    conversationId: Annotation<string>({
        reducer: (_, next) => next,
        default: () => '',
    }),
    userId: Annotation<string>({
        reducer: (_, next) => next,
        default: () => '',
    }),
    context: Annotation<ConversationContext>({
        reducer: (_, next) => next,
        default: () => 'idle',
    }),

    // Collected item data
    itemData: Annotation<CollectedItemData>({
        reducer: (prev, next) => ({ ...prev, ...next }),
        default: () => ({}),
    }),

    // Flow control
    currentNode: Annotation<GraphNode>({
        reducer: (_, next) => next,
        default: () => 'greet',
    }),
    turnCount: Annotation<number>({
        reducer: (prev, next) => next ?? prev + 1,
        default: () => 0,
    }),
    invalidAttempts: Annotation<number>({
        reducer: (_, next) => next,
        default: () => 0,
    }),

    // User input
    lastUserMessage: Annotation<string>({
        reducer: (_, next) => next,
        default: () => '',
    }),
    // Support both single image (backward compat) and multiple images
    imageBase64: Annotation<string | string[] | undefined>({
        reducer: (_, next) => next,
        default: () => undefined,
    }),

    // Response output
    responseMessage: Annotation<string>({
        reducer: (_, next) => next,
        default: () => '',
    }),
    responseChips: Annotation<ResponseChip[]>({
        reducer: (_, next) => next,
        default: () => [],
    }),

    // Results
    matches: Annotation<MatchResult[]>({
        reducer: (_, next) => next,
        default: () => [],
    }),
    pendingMatch: Annotation<MatchResult | undefined>({
        reducer: (_, next) => next,
        default: () => undefined,
    }),
    pendingLostItemId: Annotation<string | undefined>({
        reducer: (_, next) => next,
        default: () => undefined,
    }),
    savedItemId: Annotation<string | undefined>({
        reducer: (_, next) => next,
        default: () => undefined,
    }),
    isComplete: Annotation<boolean>({
        reducer: (_, next) => next,
        default: () => false,
    }),
    error: Annotation<string | undefined>({
        reducer: (_, next) => next,
        default: () => undefined,
    }),
});

/**
 * Type for the full state
 */
export type ReportFlowState = typeof ReportFlowAnnotation.State;

/**
 * Safety limits for conversation
 */
export const SAFETY_LIMITS = {
    MAX_INVALID_ATTEMPTS: 3,
    MAX_TURNS_PER_CONVERSATION: 15,
    SESSION_TIMEOUT_MINUTES: 5,
    CHAT_HISTORY_TTL_DAYS: 7,
    MATCH_THRESHOLD_PERCENT: 60,
    LOCATION_RADIUS_KM: 2,
} as const;
