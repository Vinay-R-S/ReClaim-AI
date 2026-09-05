import { Timestamp } from 'firebase-admin/firestore';

export type HandoverCodeStatus = 'pending' | 'verified' | 'blocked' | 'expired';

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

export interface Handover {
  id?: string;
  matchId: string;
  lostItemId: string;
  foundItemId: string;
  lostPersonId: string;
  foundPersonId: string;
  lostPersonEmail: string;
  foundPersonEmail: string;
  itemName: string;
  itemDetails: any; // Snapshot
  codeHash: string; // The code used
  handoverTime: Timestamp;
  createdAt: Timestamp;
}
