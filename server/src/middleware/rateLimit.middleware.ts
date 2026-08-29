/**
 * Rate Limiting Middleware - Prevent brute-force attacks
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

/**
 * Auth routes: 5 requests per 15 minutes per IP
 * Prevents brute-force login attempts
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    error: 'Too many authentication attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests
});

/**
 * General API routes: 10,000 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  message: {
    error: 'Too many requests. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Password reset: 3 requests per hour per IP
 * Prevents email spam attacks
 */
export const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: {
    error: 'Too many reset attempts. Please try again in 1 hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Item creation: 10 items per hour per IP
 * Prevents spam item creation
 */
export const itemCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100, // Increased from 10 to 100 items per hour
  message: {
    error: 'You have created too many items. Please wait before creating more.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Testing mode: 400 requests per day globally
 * Applied when testingMode is enabled in admin settings
 * This is for public demos/sharing when you want to limit API usage
 */
export const testingApiLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 400,
  message: {
    error:
      'Daily API limit reached (400 calls). This is a demo deployment. Please try again tomorrow.',
    isRateLimited: true,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Handover code verification stays public, because the finder holds only an
 * emailed link and has no account. The key is the match id plus a normalised
 * client address, so a single caller cannot grind codes across many handovers.
 * `ipKeyGenerator` collapses an IPv6 client to its /64: without it a caller can
 * rotate addresses inside its own prefix for a fresh bucket each time, and
 * express-rate-limit refuses a bare `req.ip` key with ERR_ERL_KEY_GEN_IPV6.
 */
export const handoverVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'Too many verification attempts for this handover. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const matchId = (req.params?.matchId as string) || (req.body?.matchId as string) || 'unknown';
    return `${ipKeyGenerator(req.ip ?? '')}:${matchId}`;
  },
});

/**
 * Handover status polling. Separate from the verify limiter on purpose: the
 * verify page reads status on mount and again after every failed attempt, so
 * sharing one 10-request bucket made a legitimate session run out of quota and
 * surface as "session not found".
 */
export const handoverStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: {
    error: 'Too many status checks. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const matchId = (req.params?.matchId as string) || 'unknown';
    return `${ipKeyGenerator(req.ip ?? '')}:${matchId}`;
  },
});
