/**
 * AI analysis request schemas
 */

import { z } from 'zod';
import { imagePayload, optionalMultilineText, optionalText, text } from './common.schema.js';

// The file inputs accept `image/*`, so anything a browser reports for a picked
// file has to get through: pinning a short list here would reject a HEIC or
// AVIF upload that used to reach the provider.
const imageMimeType = z
  .string()
  .max(100)
  .regex(/^image\/[a-zA-Z0-9.+-]+$/, 'Must be an image MIME type');

// Roughly 1.5mb of source image once base64 expands it. Five of these still
// fit inside the 10mb body limit, so an oversized photo gets a message naming
// the problem instead of Express's HTML 413 page.
const MAX_IMAGE_CHARS = 2_000_000;

export const analyzeImageSchema = z.object({
  images: z
    .array(
      z.object({
        base64: imagePayload.max(MAX_IMAGE_CHARS, 'Image is too large, please use a smaller photo'),
        mimeType: imageMimeType.optional(),
      }),
    )
    .min(1, 'At least one image is required')
    .max(5, 'Maximum 5 images allowed'),
});

export const enhanceDescriptionSchema = z.object({
  name: text(1, 200),
  description: optionalMultilineText(2000),
  category: optionalText(100),
});

export type AnalyzeImageBody = z.infer<typeof analyzeImageSchema>;
export type EnhanceDescriptionBody = z.infer<typeof enhanceDescriptionSchema>;
