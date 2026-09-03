/**
 * Auth request schemas
 */

import { z } from 'zod';
import { emailString, optionalText } from './common.schema.js';

export const signupSchema = z.object({
  email: emailString,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  displayName: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name too long').optional(),
});

export const loginSchema = z.object({
  email: emailString,
  password: z.string().min(1, 'Password is required'),
});

export const loginNotificationSchema = z.object({
  loginTime: optionalText(100),
});
