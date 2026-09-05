/**
 * Item request schemas
 */

import { z } from 'zod';
import {
  coordinatesSchema,
  emailString,
  imagePayload,
  isoDateString,
  multilineText,
  optionalMultilineText,
  optionalText,
  text,
} from './common.schema.js';

export const itemTypeSchema = z.enum(['Lost', 'Found'], {
  errorMap: () => ({ message: 'Type must be "Lost" or "Found"' }),
});

export const itemStatusSchema = z.enum(['Pending', 'Matched', 'Claimed'], {
  errorMap: () => ({ message: 'Invalid status' }),
});

export const itemInputSchema = z.object({
  item: z.object({
    name: text(1, 200),
    description: multilineText(10, 2000),
    type: itemTypeSchema,
    location: text(1, 500),
    date: isoDateString,
    category: optionalText(100),
    color: optionalText(50),
    tags: z.array(text(1, 50)).max(10, 'Maximum 10 tags allowed').optional(),
    coordinates: coordinatesSchema.optional(),
    // `collectionPoint` is canonical. `collectionLocation` is what the report
    // form has always sent and is accepted as an alias, mapped on write.
    collectionPoint: optionalText(500),
    collectionLocation: optionalText(500),
    collectionCoordinates: coordinatesSchema.optional(),
    reporterEmail: emailString.optional(),
  }),
  images: z.array(imagePayload).max(5, 'Maximum 5 images allowed').optional(),
  // Accepted and ignored: the owner always comes from the token.
  userId: z.string().max(128).optional(),
});

/**
 * Fields a request may change on an existing item.
 *
 * `status`, `type` and `matchScore` are admin only and are dropped for anyone
 * else in the handler. Everything absent from this list is server owned
 * (reportedBy, matchedItemId, matchedUserId, claimedBy, verifiedAt,
 * verificationConfidence, timestamps) and can never be set through this route.
 */
export const itemUpdateSchema = z.object({
  updates: z
    .object({
      name: text(1, 200).optional(),
      // Optional rather than the 10 characters required on create: items
      // reported before that rule existed have short or empty descriptions and
      // must stay editable.
      description: optionalMultilineText(2000),
      location: optionalText(500),
      // Clearing the date input serialises an invalid Date as null, which is
      // read as "leave it alone" rather than rejected.
      date: isoDateString.nullish(),
      category: optionalText(100),
      color: optionalText(50),
      tags: z.array(text(1, 50)).max(10).optional(),
      collectionPoint: optionalText(500),
      collectionLocation: optionalText(500),
      collectionCoordinates: coordinatesSchema.optional(),
      coordinates: coordinatesSchema.optional(),
      // Removal only. The handler rejects any URL not already on the item.
      cloudinaryUrls: z.array(z.string().url()).max(20).optional(),
      status: itemStatusSchema.optional(),
      type: itemTypeSchema.optional(),
      matchScore: z.number().min(0).max(100).optional(),
    })
    .optional(),
  images: z.array(imagePayload).max(5).optional(),
});

export const itemStatusUpdateSchema = z.object({
  status: itemStatusSchema,
  matchedUserId: z.string().max(128).optional(),
});

export const itemListQuerySchema = z.object({
  type: itemTypeSchema.optional(),
  status: itemStatusSchema.optional(),
  reportedBy: z.string().max(128).optional(),
  limit: z.coerce
    .number({ invalid_type_error: 'Limit must be a number' })
    .int('Limit must be a whole number')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit must be at most 100')
    .default(50),
});

export type ItemUpdateBody = z.infer<typeof itemUpdateSchema>;
export type ItemStatusUpdateBody = z.infer<typeof itemStatusUpdateSchema>;
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;
