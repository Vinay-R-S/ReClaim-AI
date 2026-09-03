/**
 * Handover request schemas
 */

import { z } from 'zod';
import { idString } from './common.schema.js';

export const handoverInitiateSchema = z.object({
  matchId: idString,
  lostItemId: idString,
  foundItemId: idString,
});

export const handoverVerifySchema = z.object({
  matchId: idString,
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Code must be 6 digits'),
});
