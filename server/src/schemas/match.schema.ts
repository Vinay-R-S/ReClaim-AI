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

export const matchVerifySchema = z
  .object({
    itemId: idString,
    // The match record being decided on. The admin list shows every candidate
    // match, including ones whose items never had `matchedItemId` written,
    // so the pair is taken from the record when the caller names one.
    matchId: idString.optional(),
    // Only the rejection path uses this, and only to name who the penalty is
    // for. A dismissal of a proposal nobody claimed has no such person, and a
    // lost item whose reporter is gone must still be dismissable.
    claimUserId: idString.optional(),
    isValid: z.boolean({ required_error: 'isValid is required' }),
    // A manual admin verification may proceed despite failing the strict
    // distance, day and time handover checks. Recorded in the audit trail.
    overrideCriteria: z.boolean().optional(),
    overrideReason: optionalMultilineText(500),
    // A rejection may also charge the claimant for a false claim. It is the
    // admin's explicit decision, never inferred: the same screen dismisses
    // pipeline proposals nobody ever claimed.
    penaliseClaimant: z.boolean().optional(),
  })
  .refine((body) => !body.penaliseClaimant || Boolean(body.claimUserId), {
    message: 'claimUserId is required to charge the false-claim penalty',
    path: ['claimUserId'],
  });

export type MatchVerifyBody = z.infer<typeof matchVerifySchema>;
