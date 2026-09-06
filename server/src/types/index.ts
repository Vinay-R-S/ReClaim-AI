import { Timestamp } from 'firebase-admin/firestore';
import type {
  AdminAuditEntry as SharedAdminAuditEntry,
  Coordinates,
  Item as SharedItem,
  ItemInput as SharedItemInput,
  Match as SharedMatch,
  User as SharedUser,
} from '../../../shared/domain.js';

/**
 * Domain types come from `shared/domain.d.ts`, which the client imports too.
 * Both packages used to declare their own and had drifted (defect ARCH-08).
 * Only the timestamp class is local: this is the Admin SDK's.
 */
export type { Coordinates };

// `SystemSettings` is deliberately not re-exported here: the server's own
// version in `settings.types.ts` adds the write-time timestamp, and two
// exported types under one name is how they drift apart again.
export type { AIProvider, LlmProviderName, MapCenter } from '../../../shared/domain.js';

export type {
  AdminAuditAction,
  HandoverCodeStatus,
  HandoverItemSnapshot,
  HandoverPersonSnapshot,
  HandoverStatus,
  ItemStatus,
  ItemType,
  MatchStatus,
  ModerationStatus,
  SerializedTimestamp,
  UserProfile,
  UserRole,
  UserStatus,
  VerifyCodeResult,
} from '../../../shared/domain.js';

export type User = SharedUser<Timestamp>;
export type Item = SharedItem<Timestamp>;
export type Match = SharedMatch<Timestamp>;
export type AdminAuditEntry = SharedAdminAuditEntry<Timestamp>;

/**
 * The reporter's submission, plus what only the server holds: the images as
 * they arrive on the request, and the owner it resolves from the token.
 */
export interface ItemInput extends SharedItemInput {
  images?: File[] | string[];
  reportedBy: string;
  reporterEmail?: string;
}

export * from './handover.js';

// ============ Conversation Types ============
export type ConversationContext =
  'report_lost' | 'report_found' | 'check_matches' | 'find_collection' | 'idle';

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

// ============ Credit Types ============
export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  reason:
    | 'signup_bonus'
    | 'report_found'
    | 'successful_match_finder'
    | 'successful_match_owner'
    | 'false_claim'
    | 'manual_adjustment';
  relatedItemId?: string;
  /** Balance after this entry was applied. */
  balanceAfter?: number;
  /** Free text, set on a manual admin adjustment. */
  note?: string;
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
  /** Scored submissions so far, capped to stop repeated guessing. */
  submissions?: number;
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
  MATCH_THRESHOLD_PERCENT: 75, // Restored to 75%
  LOCATION_RADIUS_KM: 10, // Maximum distance for matching (km)
  TIME_WINDOW_HOURS: 72, // Maximum time difference (hours)
} as const;

// ============ Credit Constants ============
export const CREDIT_VALUES = {
  SIGNUP_BONUS: 10, // New user welcome bonus
  REPORT_FOUND: 0, // No credits for just reporting (changed from 20)
  SUCCESSFUL_MATCH_FINDER: 20, // Credits awarded when handover completes (changed from 50)
  SUCCESSFUL_MATCH_OWNER: 10, // Credits awarded to claimer when handover completes
  FALSE_CLAIM: -30,
} as const;
