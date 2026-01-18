/**
 * Rate Limiting Middleware - Prevent brute-force attacks
 */

import rateLimit from 'express-rate-limit';

/**
 * Auth routes: 5 requests per 15 minutes per IP
 * Prevents brute-force login attempts
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: {
        error: 'Too many authentication attempts. Please try again in 15 minutes.'
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
        error: 'Too many requests. Please slow down.'
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
        error: 'Too many reset attempts. Please try again in 1 hour.'
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
    max: 100,  // Increased from 10 to 100 items per hour
    message: {
        error: 'You have created too many items. Please wait before creating more.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
