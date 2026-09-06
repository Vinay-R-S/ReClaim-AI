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
  displayName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name too long')
    .optional(),
});

export const loginSchema = z.object({
  email: emailString,
  password: z.string().min(1, 'Password is required'),
});

export const loginNotificationSchema = z.object({
  loginTime: optionalText(100),
});

/**
 * Everything that decides authority (role, status, credits) is set by the
 * server, so the caller may only supply display fields.
 *
 * Both are dropped rather than rejected when they do not fit. This is the only
 * route that creates `users/{uid}`, and every other authenticated endpoint 404s
 * without that document, so a 55-character Google display name must not be able
 * to wedge an account out of the app permanently.
 */
export const profileBootstrapSchema = z.object({
  displayName: z
    .string()
    .transform((value) => value.trim().slice(0, 50))
    .optional()
    .catch(undefined),
  photoURL: z.string().url().max(2048).optional().catch(undefined),
});

export type ProfileBootstrapBody = z.infer<typeof profileBootstrapSchema>;
export type LoginNotificationBody = z.infer<typeof loginNotificationSchema>;
