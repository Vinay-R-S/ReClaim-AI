/**
 * The client's view of the shared domain contract.
 *
 * `shared/domain.d.ts` is the single description of what a document holds, and
 * the server imports the same file. This module does one job: it fills in the
 * timestamp type, which is the Web SDK's `Timestamp` here and the Admin SDK's
 * on the server. Nothing in `client/src` should declare these shapes again.
 */

import type { Timestamp } from 'firebase/firestore';
import type {
  AdminAuditEntry as SharedAdminAuditEntry,
  CreditTransaction as SharedCreditTransaction,
  HandoverItemSnapshot as SharedHandoverItemSnapshot,
  HandoverRecord as SharedHandoverRecord,
  Item as SharedItem,
  ItemInput as SharedItemInput,
  Match as SharedMatch,
  SerializedTimestamp,
  User as SharedUser,
} from '../../../shared/domain';

export type {
  AdminAuditAction,
  AIProvider,
  CreditBalance,
  CreditReason,
  AnalyticsResponse,
  Coordinates,
  DashboardKpis,
  DashboardStats,
  LlmProviderName,
  MapCenter,
  SystemSettings,
  SystemSettingsResponse,
  HandoverCodeStatus,
  HandoverPersonSnapshot,
  HandoverSession,
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
} from '../../../shared/domain';

export type Item = SharedItem<Timestamp>;
export type Match = SharedMatch<Timestamp>;
export type User = SharedUser<Timestamp>;

/**
 * The reporter's submission, plus what only this side holds: the images the
 * form has collected and the status the admin edit form binds to a select.
 * Neither reaches the server as a decision; the API allowlists what it accepts.
 */
export interface ItemInput extends SharedItemInput {
  imageUrl?: string;
  images?: string[];
  status?: Item['status'];
  matchScore?: number;
}

/**
 * Records that only ever arrive over JSON, so their timestamps have lost the
 * SDK class they were written with.
 */
export type HandoverRecord = SharedHandoverRecord<SerializedTimestamp>;
export type HandoverItemSnapshot = SharedHandoverItemSnapshot<SerializedTimestamp>;
export type AdminAuditEntry = SharedAdminAuditEntry<SerializedTimestamp>;
export type CreditTransaction = SharedCreditTransaction<SerializedTimestamp>;
