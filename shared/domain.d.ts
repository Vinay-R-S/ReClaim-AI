/**
 * Domain types shared by the client and the server.
 *
 * Both packages used to declare these independently and had already drifted:
 * the client required a `status` on every item input and carried a
 * `contactEmail` nothing wrote, the server declared neither `claimedBy` nor
 * `bestCandidateScore` despite writing both, and the handover record had three
 * different shapes across the two packages (defect ARCH-08). This file is the
 * single description of what a document actually holds.
 *
 * Two rules keep it importable from both sides:
 *
 * 1. It is a `.d.ts`, so it emits nothing. The server compiles with
 *    `rootDir: ./src` and would otherwise refuse a source file above it.
 * 2. It declares types only. Both packages import it with `import type`, which
 *    is erased at compile time, so neither build resolves it at runtime and
 *    neither deployment needs this directory.
 *
 * Timestamp-valued fields are generic. A Firestore timestamp is a different
 * class in `firebase-admin/firestore` than in `firebase/firestore`, and a
 * value that has been through JSON is neither. Each package supplies the one
 * it actually holds.
 */

/** A timestamp as it survives JSON: the class is gone, the seconds remain. */
export interface SerializedTimestamp {
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
  /** Present when the value came from a Firestore SDK rather than from JSON. */
  toDate?: () => Date;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

/* ============ Items ============ */

export type ItemType = 'Lost' | 'Found';

/**
 * The item lifecycle, in order.
 *
 * `Pending`  reported, looking for a match.
 * `Matched`  paired with a counterpart, handover not yet completed.
 * `Claimed`  handed over and closed. The only terminal state.
 */
export type ItemStatus = 'Pending' | 'Matched' | 'Claimed';

/**
 * Whether an admin has reviewed the report, independent of the match state.
 *
 * `status` answers "has this item found its counterpart"; `moderation` answers
 * "may this item be seen and matched at all". A document with no `moderation`
 * field predates review and reads as approved.
 */
export type ModerationStatus = 'pending' | 'approved' | 'rejected';

/** A persisted item, as both packages read it. */
export interface Item<TTime = unknown> {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  status: ItemStatus;
  /** Absent on items created before moderation existed, which read as approved. */
  moderation?: ModerationStatus;
  moderatedBy?: string;
  moderatedAt?: TTime;
  /** Why the report was rejected. Required on a rejection. */
  moderationReason?: string;
  location: string;
  coordinates?: Coordinates;
  date: TTime | Date;
  tags?: string[];
  color?: string;
  category?: string;
  imageUrl?: string;
  /** Base64 or URLs carried on the document itself. */
  images?: string[];
  cloudinaryUrls?: string[];
  embedding?: number[];
  matchScore?: number;
  /** Best score seen while matching when nothing crossed the threshold. */
  bestCandidateScore?: number;
  /** Set while a matching run holds the item, so a second run does not start. */
  matchingStartedAt?: TTime;
  reportedBy: string;
  reportedByEmail?: string;
  matchedItemId?: string;
  matchedUserId?: string;
  /** Written by POST /api/matches/claim onto the found item. */
  claimedBy?: string;
  verificationRequired?: boolean;
  verificationConfidence?: number;
  verifiedBy?: string;
  verifiedAt?: TTime;
  collectionPoint?: string;
  collectionCoordinates?: Coordinates;
  collectionInstructions?: string;
  createdAt?: TTime;
  updatedAt?: TTime;
}

/**
 * What a reporter submits, common to both packages.
 *
 * Only the fields a reporter actually supplies. Everything the server decides
 * (status, moderation, scores, ownership) is deliberately absent: the client
 * cannot set them and the server does not read them from the request.
 */
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
  /** For Found items: where the owner collects it. Canonical name. */
  collectionPoint?: string;
  /** Accepted alias for `collectionPoint`, mapped on write. */
  collectionLocation?: string;
  collectionCoordinates?: Coordinates;
}

/* ============ Matches ============ */

/** `rejected` is an admin refusal of a proposal, kept rather than deleted. */
export type MatchStatus = 'matched' | 'claimed' | 'rejected';

export interface Match<TTime = unknown> {
  id: string;
  lostItemId: string;
  foundItemId: string;
  /** Total: the sum of the breakdown below, out of 100. */
  matchScore: number;
  semanticScore?: number;
  /** Written as the semantic score; the name is kept for the older screens. */
  tagScore: number;
  descriptionScore?: number;
  colorScore: number;
  categoryScore?: number;
  locationScore?: number;
  timeScore?: number;
  imageScore: number;
  status: MatchStatus;
  /** True for a live match, false for one read out of `matchHistory`. */
  isActive?: boolean;
  createdAt: TTime;
  updatedAt?: TTime;
  claimedAt?: TTime;
}

/* ============ Users ============ */

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'blocked';

export interface User<TTime = unknown> {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role: UserRole;
  status: UserStatus;
  credits: number;
  /** Set once the welcome bonus has landed in the ledger. */
  signupBonusAwarded?: boolean;
  createdAt?: TTime;
  lastLoginAt?: TTime;
  lostItemsCount?: number;
  foundItemsCount?: number;
  totalItemsCount?: number;
}

/** The profile as `POST /api/auth/profile` returns it, over JSON. */
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  status: UserStatus;
  credits: number;
}

/* ============ Handovers ============ */

/**
 * Status of the handover code document.
 *
 * The client tested for `completed` and `failed` for a while, neither of which
 * the server has ever sent (defect UI-06).
 */
export type HandoverCodeStatus = 'pending' | 'verified' | 'blocked' | 'expired';

/** `GET /api/handover/status/:matchId`. */
export interface HandoverStatus {
  status: HandoverCodeStatus;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
}

/** `POST /api/handover/verify`. */
export interface VerifyCodeResult {
  success: boolean;
  message: string;
  attemptsLeft?: number;
}

/** The item as it was at the moment of handover. Nulls are what was missing. */
export interface HandoverItemSnapshot<TTime = unknown> {
  name: string | null;
  description: string | null;
  location: string | null;
  date: TTime | Date | string | null;
  color?: string | null;
  category?: string | null;
  tags?: string[] | null;
  imageUrl?: string | null;
  collectionPoint?: string | null;
}

export interface HandoverPersonSnapshot {
  userId: string | null;
  email: string | null;
  displayName: string | null;
}

/**
 * A completed handover, as written by the handover service and read by both
 * the admin history and the user's own list.
 */
export interface HandoverRecord<TTime = unknown> {
  id: string;
  matchId: string;
  lostItemId: string;
  foundItemId: string;
  lostPersonId: string | null;
  foundPersonId: string | null;
  matchScore: number;
  matchCreatedAt?: TTime | null;
  lostItemDetails: HandoverItemSnapshot<TTime>;
  foundItemDetails: HandoverItemSnapshot<TTime>;
  lostPersonDetails: HandoverPersonSnapshot;
  foundPersonDetails: HandoverPersonSnapshot;
  /** Hashed, kept for reference only. */
  verificationCode?: string | null;
  handoverTime: TTime | Date | string | number;
  createdAt?: TTime;
  status: 'completed';
  blockchainRecorded?: boolean;
  blockchainTxHash?: string;
  blockchainError?: string;
  blockchainRecordedAt?: TTime;
}

/* ============ Admin audit ============ */

export type AdminAuditAction =
  'item_approved' | 'item_rejected' | 'match_verified' | 'match_rejected';

export interface AdminAuditEntry<TTime = unknown> {
  id: string;
  action: AdminAuditAction;
  targetId: string;
  actorId: string;
  reason?: string;
  details?: Record<string, unknown>;
  createdAt?: TTime;
}

/* ============ System settings ============ */

/** An LLM provider this deployment can be pointed at. */
export type LlmProviderName = 'groq' | 'gemini' | 'grok';

/**
 * Which provider runs, and whether a failure falls through to another.
 *
 * The `_only` variants exist so an operator can pin a provider while
 * diagnosing one, rather than having a fallback hide the problem.
 */
export type AIProvider =
  | 'groq_only'
  | 'gemini_only'
  | 'grok_only'
  | 'groq_with_fallback'
  | 'gemini_with_fallback'
  | 'grok_with_fallback';

export interface MapCenter {
  address: string;
  lat: number;
  lng: number;
}

export interface SystemSettings {
  aiProvider: AIProvider;
  mapCenter?: MapCenter;
  cctvEnabled: boolean;
  /** true = Testing (daily call budget), false = Dev (unlimited). */
  testingMode: boolean;
}

/**
 * `GET /api/settings`. Carries which providers actually have a key, so the
 * admin screen can stop someone selecting one that would kill every AI
 * feature.
 */
export interface SystemSettingsResponse extends SystemSettings {
  availableProviders?: LlmProviderName[];
}

export interface AnalyticsResponse {
  visitorCount: number;
  lastVisit?: unknown;
}

/* ============ Dashboard statistics ============ */

export interface DashboardKpis {
  totalItems: number;
  lostTotal: number;
  foundTotal: number;
  activeLost: number;
  activeFound: number;
  totalMatches: number;
  pendingReview: number;
  claimed: number;
  matched: number;
  matchSuccessRate: number;
}

/**
 * `GET /api/stats/dashboard`: everything the admin dashboard draws, computed
 * server side so the browser stops reading three whole collections to count
 * them (defect PERF-07).
 */
export interface DashboardStats {
  kpis: DashboardKpis;
  scoreDistribution: { range: string; count: number }[];
  matchTrend: { date: string; matches: number }[];
  handoverTrend: { date: string; handovers: number }[];
  /** All-time, not the windowed trend above. */
  totalHandovers: number;
  efficiency: { matched: number; unmatched: number };
  recentMatches: {
    id: string;
    matchScore: number;
    lostItemName: string;
    foundItemName: string;
    createdAt: string | null;
  }[];
  /** Just enough of an item to place and label a marker. */
  heatmapPoints: {
    id: string;
    name: string;
    type: ItemType;
    status: ItemStatus;
    location: string;
    lat: number;
    lng: number;
  }[];
  mapCenter?: MapCenter;
  generatedAt: string;
}
