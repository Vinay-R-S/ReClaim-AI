/**
 * Handover request schemas
 */

import { z } from 'zod';
import { idString, optionalText } from './common.schema.js';

export const handoverInitiateSchema = z.object({
  matchId: idString,
  lostItemId: idString,
  foundItemId: idString,
  // Issue the code even though the strict distance, day and time checks fail.
  // Admin only, recorded in the handover audit trail.
  overrideCriteria: z.boolean().optional(),
  overrideReason: optionalText(500),
});

export const handoverReissueSchema = z.object({
  matchId: idString,
  lostItemId: idString,
  foundItemId: idString,
  overrideCriteria: z.boolean().optional(),
  overrideReason: optionalText(500),
});

export const handoverVerifySchema = z.object({
  matchId: idString,
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Code must be 6 digits'),
});
