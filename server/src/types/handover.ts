import { Timestamp } from 'firebase-admin/firestore';
import type {
  HandoverCodeStatus,
  HandoverRecord as SharedHandoverRecord,
} from '../../../shared/domain.js';

export type { HandoverCodeStatus };

/**
 * Version of the algorithm behind `codeHash`.
 *
 * 1 is the retired bare SHA-256 of the code, kept only so codes issued before
 * the HMAC change still verify. 2 is HMAC-SHA256 keyed on HANDOVER_CODE_SECRET.
 * A document with no `codeHashVersion` is version 1.
 */
export type HandoverCodeHashVersion = 1 | 2;

export interface HandoverCode {
  matchId: string;
  lostItemId: string;
  foundItemId: string;
  codeHash: string;
  codeHashVersion?: HandoverCodeHashVersion;
  attempts: number;
  expiresAt: Timestamp;
  createdAt: Timestamp;
  status: HandoverCodeStatus;
  /** Set when an admin issued this code despite failing handover criteria. */
  criteriaOverrideBy?: string;
  /** The admin's own justification, null when they gave none. */
  criteriaOverrideReason?: string | null;
  /** The check that was overridden, as reported by validateHandoverCriteria. */
  criteriaFailure?: string;
  blockedAt?: Timestamp;
  verifiedAt?: Timestamp;
  expiredAt?: Timestamp;
  handoverId?: string;
  /** Set when the code was accepted but the completion write partly failed. */
  completionError?: string;
}

/**
 * A completed handover.
 *
 * The shape lives in `shared/domain.d.ts` because the admin history and the
 * user's own list both read it. The interface declared here described a
 * document the service has never written: `itemName`, `lostPersonEmail` and a
 * single `itemDetails` blob, where the write puts `lostItemDetails`,
 * `foundItemDetails` and a person snapshot on each side (defect ARCH-08).
 */
export type Handover = SharedHandoverRecord<Timestamp>;
