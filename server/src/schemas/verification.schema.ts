/**
 * Verification request schemas
 */

import { z } from 'zod';
import { idString, text } from './common.schema.js';

export const verificationStartSchema = z.object({
  itemId: idString,
});

export const verificationAnswerSchema = z.object({
  questionIndex: z
    .number({ invalid_type_error: 'questionIndex must be a number' })
    .int('questionIndex must be a whole number')
    .min(0, 'questionIndex out of range')
    .max(50, 'questionIndex out of range'),
  answer: text(1, 1000),
});
