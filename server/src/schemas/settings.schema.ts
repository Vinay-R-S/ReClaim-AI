/**
 * Settings request schemas
 */

import { z } from 'zod';
import { imagePayload, optionalText } from './common.schema.js';

export const aiProviderSchema = z.enum(
  [
    'groq_only',
    'gemini_only',
    'grok_only',
    'groq_with_fallback',
    'gemini_with_fallback',
    'grok_with_fallback',
  ],
  { errorMap: () => ({ message: 'Invalid AI provider' }) },
);

export const settingsUpdateSchema = z.object({
  aiProvider: aiProviderSchema,
  cctvEnabled: z.boolean().optional(),
  testingMode: z.boolean().optional(),
  mapCenter: z
    .object({
      address: optionalText(500),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
});

export const profilePictureSchema = z.object({
  imageData: imagePayload,
  // Accepted and ignored: the target user always comes from the token.
  userId: z.string().max(128).optional(),
});

export type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>;
export type ProfilePictureBody = z.infer<typeof profilePictureSchema>;
