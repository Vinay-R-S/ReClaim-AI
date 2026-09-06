import { Timestamp } from 'firebase-admin/firestore';
import type {
  AdminAuditEntry as SharedAdminAuditEntry,
  Coordinates,
  CreditTransaction as SharedCreditTransaction,
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
  CreditBalance,
  CreditReason,
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

// ============ Credit Types ============
export type CreditTransaction = SharedCreditTransaction<Timestamp>;

// ============ Credit Constants ============
export const CREDIT_VALUES = {
  SIGNUP_BONUS: 10, // New user welcome bonus
  REPORT_FOUND: 0, // No credits for just reporting (changed from 20)
  SUCCESSFUL_MATCH_FINDER: 20, // Credits awarded when handover completes (changed from 50)
  SUCCESSFUL_MATCH_OWNER: 10, // Credits awarded to claimer when handover completes
  FALSE_CLAIM: -30,
} as const;
