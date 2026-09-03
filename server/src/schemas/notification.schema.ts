/**
 * Notification request schemas
 */

import { z } from 'zod';
import { emailString, optionalText, text } from './common.schema.js';

export const sendMatchNotificationSchema = z.object({
  email: emailString,
  itemName: text(1, 200),
  matchScore: z.number().min(0).max(100).optional(),
  collectionPoint: optionalText(500),
});

export const sendClaimNotificationSchema = z.object({
  email: emailString,
  itemName: text(1, 200),
  collectionPoint: text(1, 500),
});
