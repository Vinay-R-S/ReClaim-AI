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

/**
 * The adjudication agent's verdict on a pair (section 8.6).
 *
 * Present only on a match the agent was actually asked about: one whose score
 * fell in the uncertainty band while `ADJUDICATION_MODE` was not `off`. Every
 * string in here is model-written text derived from what members of the public
 * typed, so it is rendered as text and never as markup.
 */
export type AdjudicationDecision = 'match' | 'no_match' | 'needs_human_review';

/**
 * Why an agent run stopped.
 *
 * There is no value for a model failure: a run whose model call failed reached
 * no verdict at all and is not persisted. A stored trace always carries a
 * verdict the model actually gave.
 */
export type AdjudicationStop = 'verdict' | 'tool_budget' | 'deadline';

export interface AdjudicationStepRecord {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  failed: boolean;
}

export interface AdjudicationRecord {
  decision: AdjudicationDecision;
  /** 0-100, the agent's confidence in its own verdict. */
  confidence: number;
  evidence: string[];
  contradictions: string[];
  steps: AdjudicationStepRecord[];
  toolCalls: number;
  stoppedBy: AdjudicationStop;
  model: string;
  provider: string;
  promptVersion: string;
  costUsd: number;
  ms: number;
  /** `shadow` means the verdict was recorded and acted on by nothing. */
  mode: 'shadow' | 'on';
  /** The deterministic score that put the pair in the band. */
  pipelineScore: number;
}

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
  /** The agent's reasoning, when this pair was adjudicated. */
  adjudication?: AdjudicationRecord;
  /**
   * True when the adjudication agent stopped the automatic handover and left
   * the pair for an admin. The status stays `matched`; this is what tells the
   * two apart without opening the record.
   */
  handoverHeld?: boolean;
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

/* ============ Credits ============ */

/**
 * One entry in the credit ledger.
 *
 * The ledger is the record; `users/{uid}.credits` is the running total it adds
 * up to (defect LOG-01).
 */
export type CreditReason =
  | 'signup_bonus'
  | 'report_found'
  | 'successful_match_finder'
  | 'successful_match_owner'
  | 'false_claim'
  | 'manual_adjustment';

/** What `GET /api/credits/:userId` answers with. */
export interface CreditBalance {
  userId: string;
  email: string;
  credits: number;
}

export interface CreditTransaction<TTime = unknown> {
  id: string;
  userId: string;
  amount: number;
  reason: CreditReason;
  relatedItemId?: string;
  /** Balance after this entry was applied. */
  balanceAfter?: number;
  /** Free text, set on a manual admin adjustment. */
  note?: string;
  createdAt: TTime;
}

/* ============ Handovers ============ */

/**
 * Status of the handover code document.
 *
 * The client tested for `completed` and `failed` for a while, neither of which
 * the server has ever sent (defect UI-06).
 */
export type HandoverCodeStatus = 'pending' | 'verified' | 'blocked' | 'expired';

/**
 * Where a handover is in its state machine (PLAN.md 10.1).
 *
 * `status` above is the projection of this through the four values that
 * existed before the event log, and both are returned so a client written
 * against the old vocabulary keeps working. New code should read `state`:
 * `status` cannot tell `verified` from `completed`, or `cancelled` from
 * `expired`, and both distinctions decide what an admin can do next.
 */
export type HandoverState =
  | 'initiated'
  | 'code_issued'
  | 'awaiting_meet'
  | 'verified'
  | 'completed'
  | 'blocked'
  | 'expired'
  | 'cancelled'
  | 'disputed'
  | 'reverted';

export type HandoverTransition =
  | 'issue_code'
  | 'reissue_code'
  | 'present_code'
  | 'confirm_receipt'
  | 'complete'
  | 'fail_attempt'
  | 'block'
  | 'expire'
  | 'cancel'
  | 'dispute'
  | 'revert';

/** Who caused a transition. `system` is the pipeline or a worker. */
export type HandoverActorRole = 'system' | 'owner' | 'finder' | 'admin';

/** One row of the append-only handover event log. */
export interface HandoverEvent<TTime = unknown> {
  id: string;
  handoverId: string;
  /** Null for the first event of a handover. */
  from: HandoverState | null;
  to: HandoverState;
  transition: HandoverTransition;
  /** The uid that caused it, or null for the system. */
  actor: string | null;
  actorRole: HandoverActorRole;
  reason: string | null;
  metadata: Record<string, unknown>;
  /** Position in this handover's log. Ordering is by this, not by time. */
  sequence: number;
  at: TTime;
}

/**
 * `GET /api/handover/status/:matchId`.
 *
 * The three fields the event log added are optional, and deliberately so. The
 * client and the API deploy separately, so a browser holding the new bundle
 * can be talking to a server that predates phase 26 and sends only `status`.
 * The verify page reads `state` where it is there and falls back to `status`
 * where it is not; typing them as required would make that fallback look like
 * dead code and invite somebody to delete it.
 */
export interface HandoverStatus {
  status: HandoverCodeStatus;
  state?: HandoverState;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  /** Milliseconds until another attempt is accepted. Zero when one is. */
  retryAfterMs?: number;
  /** The finder presented the code and the owner has not confirmed receipt. */
  awaitingConfirmation?: boolean;
}

/** `GET /api/handover/qr/:matchId`. */
export interface HandoverQrToken {
  /** Submitted verbatim in the `code` field of the verify endpoint. */
  token: string;
  expiresAt: string;
}

/** `POST /api/handover/verify`. */
export interface VerifyCodeResult {
  success: boolean;
  message: string;
  attemptsLeft?: number;
  /**
   * Milliseconds to wait before another attempt is accepted.
   *
   * Present when the attempt was refused for coming too soon after the last
   * one. A six-digit code has a million values, and the attempt cap alone
   * bounds how many guesses a session allows without bounding how fast they
   * arrive.
   */
  retryAfterMs?: number;
}

/**
 * A handover session that has not completed, as `GET /api/handover/sessions`
 * returns it. The code hash is deliberately absent.
 */
export interface HandoverSession {
  matchId: string;
  lostItemId: string;
  foundItemId: string;
  status: HandoverCodeStatus;
  attempts: number;
  expiresAt: string | null;
  blockedAt: string | null;
  criteriaOverrideBy: string | null;
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

/**
 * An AI provider this deployment can be pointed at.
 *
 * Every id the server can register, not only the three the settings screen
 * offers: the rest are reached as fallbacks, which is a server decision. Keep
 * this in step with `PROVIDER_IDS` in `server/src/platform/ai/providers/registry.ts`.
 */
export type LlmProviderName = 'groq' | 'gemini' | 'grok' | 'openai' | 'anthropic' | 'local';

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
