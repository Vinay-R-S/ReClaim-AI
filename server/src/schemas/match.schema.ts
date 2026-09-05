/**
 * Match request schemas
 */

import { z } from 'zod';
import {
  coordinatesSchema,
  idString,
  imagePayload,
  isoDateString,
  optionalMultilineText,
  optionalText,
  text,
} from './common.schema.js';
import { itemTypeSchema } from './item.schema.js';

export const matchSearchSchema = z.object({
  type: itemTypeSchema.optional(),
  name: text(1, 200),
  description: optionalMultilineText(2000),
  tags: z.array(text(1, 50)).max(10).optional(),
  // Colour, location and category are scoring signals, not filters. Without
  // them a search scores on semantic and time alone, and the pipeline
  // normalises over a denominator small enough to pass lukewarm verdicts.
  color: optionalText(50),
  location: optionalText(200),
  category: optionalText(100),
  coordinates: coordinatesSchema.optional(),
  date: isoDateString.optional(),
  imageBase64: imagePayload.optional(),
});

export const matchClaimSchema = z.object({
  itemId: idString,
  lostItemId: idString.optional(),
});

export const matchVerifySchema = z.object({
  itemId: idString,
  // The match record being decided on. The admin list shows every candidate
  // match, including ones whose items never had `matchedItemId` written,
  // so the pair is taken from the record when the caller names one.
  matchId: idString.optional(),
  claimUserId: idString,
  isValid: z.boolean({ required_error: 'isValid is required' }),
  // A manual admin verification may proceed despite failing the strict
  // distance, day and time handover checks. Recorded in the audit trail.
  overrideCriteria: z.boolean().optional(),
  overrideReason: optionalMultilineText(500),
});
