/**
 * Handover request schemas
 */

import { z } from 'zod';
import { idString, optionalText } from './common.schema.js';

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

export type HandoverReissueBody = z.infer<typeof handoverReissueSchema>;
export type HandoverVerifyBody = z.infer<typeof handoverVerifySchema>;
export type HandoverConfirmBody = z.infer<typeof handoverConfirmSchema>;
