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
  text,
} from './common.schema.js';
import { itemTypeSchema } from './item.schema.js';

export const matchSearchSchema = z.object({
  type: itemTypeSchema.optional(),
  name: text(1, 200),
  description: optionalMultilineText(2000),
  tags: z.array(text(1, 50)).max(10).optional(),
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
  claimUserId: idString,
  isValid: z.boolean({ required_error: 'isValid is required' }),
});
