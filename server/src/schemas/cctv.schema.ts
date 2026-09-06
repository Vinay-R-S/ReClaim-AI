/**
 * CCTV request schemas
 */

import { z } from 'zod';
import { imagePayload, optionalMultilineText, optionalText, text } from './common.schema.js';

// One frame every 5 seconds on the client, so this bounds a video at roughly
// 25 minutes. The 10mb body limit is the real ceiling.
const MAX_FRAMES = 300;

export const cctvDetectSchema = z.object({
  image: imagePayload,
  targetClass: optionalText(100),
  targetClasses: z.array(text(1, 100)).max(50).optional(),
});

const videoFrameSchema = z.object({
  image: imagePayload,
  timestamp: z.number().min(0),
});

export const cctvAnalyzeSchema = z.object({
  frames: z
    .array(videoFrameSchema)
    .min(1, 'Frames array is required')
    .max(MAX_FRAMES, 'Too many frames'),
  targetClass: optionalText(100),
  itemName: optionalText(200),
  itemDescription: optionalMultilineText(2000),
});

export const cctvDescribeSchema = z.object({
  image: imagePayload,
  detectedClass: optionalText(100),
});

export type CctvDetectBody = z.infer<typeof cctvDetectSchema>;
export type CctvAnalyzeBody = z.infer<typeof cctvAnalyzeSchema>;
export type CctvDescribeBody = z.infer<typeof cctvDescribeSchema>;
