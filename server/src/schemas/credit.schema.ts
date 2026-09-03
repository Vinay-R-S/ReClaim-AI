/**
 * Credit request schemas
 */

import { z } from 'zod';
import { optionalText } from './common.schema.js';

export const creditAdjustmentSchema = z.object({
  amount: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .int('Amount must be a whole number')
    .min(-1000, 'Amount out of range')
    .max(1000, 'Amount out of range'),
  reason: optionalText(200),
});
