/**
 * Handover request schemas
 */

import { z } from 'zod';
import { idString, optionalText, text } from './common.schema.js';

export const handoverReissueSchema = z.object({
  matchId: idString,
  lostItemId: idString,
  foundItemId: idString,
  // Issue the code even though the strict distance, day and time checks fail.
  // Admin only, recorded in the handover audit trail.
  overrideCriteria: z.boolean().optional(),
  overrideReason: optionalText(500),
});

/**
 * A signed QR token, as `handover.qr.ts` mints it: five dot-separated parts
 * beginning with the version. Bounded so an oversized body is refused before
 * an HMAC is computed over it.
 */
const qrToken = z
  .string()
  .trim()
  .max(256)
  .regex(/^v1\.[A-Za-z0-9_-]+\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'Malformed QR token');

const sixDigits = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, 'Code must be 6 digits');

/**
 * Either credential, and exactly one of them.
 *
 * `code` stays the field name so no existing client has to change; a scanned
 * token simply arrives in it. The union is what keeps the six-digit path from
 * accepting a 256-character string and the token path from accepting anything
 * that is not shaped like a token.
 */
export const handoverVerifySchema = z.object({
  matchId: idString,
  code: z.union([sixDigits, qrToken]),
});

/** The owner confirming they have the item, when two-party is on. */
export const handoverConfirmSchema = z.object({
  matchId: idString,
});

/**
 * Undoing a completed handover.
 *
 * The reason is required and has a floor, because it is written into the
 * correction notice two members of the public receive and into the audit trail
 * a later dispute is read from. "Reverted" is not a reason, and an admin who
 * cannot say why in ten characters has not decided yet.
 */
export const handoverRevertSchema = z.object({
  matchId: idString,
  // `text` rather than a bare string, for the same reason every other free
  // field on this router uses it: this one reaches a plaintext email body, an
  // audit row and the restored match record, and the sanitiser is what stops a
  // control character being smuggled through any of them.
  reason: text(10, 500),
});

/** Either party saying a completed handover is wrong. */
export const handoverDisputeSchema = z.object({
  matchId: idString,
  reason: z.enum(['never_received', 'wrong_item', 'item_damaged', 'not_my_item', 'other']),
  // The person's own words. Shown to an admin, never branched on.
  note: optionalText(1000),
});

/** An admin deciding a dispute. */
export const handoverDisputeResolveSchema = z.object({
  matchId: idString,
  outcome: z.enum(['upheld', 'rejected']),
  note: text(10, 500),
});

export type HandoverReissueBody = z.infer<typeof handoverReissueSchema>;
export type HandoverVerifyBody = z.infer<typeof handoverVerifySchema>;
export type HandoverConfirmBody = z.infer<typeof handoverConfirmSchema>;
export type HandoverRevertBody = z.infer<typeof handoverRevertSchema>;
export type HandoverDisputeBody = z.infer<typeof handoverDisputeSchema>;
export type HandoverDisputeResolveBody = z.infer<typeof handoverDisputeResolveSchema>;
