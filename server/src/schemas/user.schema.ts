/**
 * User administration request schemas
 */

import { z } from 'zod';

export const userStatusSchema = z.enum(['active', 'blocked'], {
  errorMap: () => ({ message: 'Status must be "active" or "blocked"' }),
});

export const userStatusUpdateSchema = z.object({
  status: userStatusSchema,
});
