/**
 * Input Validation Middleware - Using Zod for schema validation
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ============= SCHEMAS =============

/**
 * Email/password signup validation
 */
export const signupSchema = z.object({
    email: z.string()
        .email('Invalid email format')
        .max(255, 'Email too long'),
    password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .max(128, 'Password too long')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
    displayName: z.string()
        .min(2, 'Name must be at least 2 characters')
        .max(50, 'Name too long')
        .optional(),
});

/**
 * Login validation
 */
export const loginSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
});

/**
 * Item input validation
 */
export const itemInputSchema = z.object({
    item: z.object({
        name: z.string()
            .min(1, 'Item name is required')
            .max(200, 'Item name too long')
            .trim(),
        description: z.string()
            .min(10, 'Description must be at least 10 characters')
            .max(2000, 'Description too long')
            .trim(),
        type: z.enum(['Lost', 'Found'], {
            errorMap: () => ({ message: 'Type must be "Lost" or "Found"' })
        }),
        location: z.string()
            .min(1, 'Location is required')
            .max(500, 'Location too long'),
        date: z.string(), // ISO date string
        category: z.string().max(100).optional(),
        color: z.string().max(50).optional(),
        tags: z.array(z.string().max(50)).max(10).optional(),
        coordinates: z.object({
            lat: z.number(),
            lng: z.number(),
        }).optional(),
        collectionLocation: z.string().max(500).optional(),
        reporterEmail: z.string().email().optional(),
    }),
    images: z.array(z.string()).max(5, 'Maximum 5 images allowed').optional(),
    userId: z.string().min(1).optional(), // Will be overwritten by auth middleware
});

/**
 * Item update validation
 */
export const itemUpdateSchema = z.object({
    updates: z.object({
        name: z.string().min(1).max(200).trim().optional(),
        description: z.string().min(10).max(2000).trim().optional(),
        location: z.string().min(1).max(500).optional(),
        date: z.string().optional(),
        category: z.string().max(100).optional(),
        color: z.string().max(50).optional(),
        tags: z.array(z.string().max(50)).max(10).optional(),
        status: z.enum(['Pending', 'Matched', 'Claimed', 'Resolved']).optional(),
    }).optional(),
    images: z.array(z.string()).max(5).optional(),
});

/**
 * User ID parameter validation
 */
export const userIdSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
});

// ============= MIDDLEWARE FACTORY =============

/**
 * Create validation middleware for a given schema
 */
export function validate<T extends z.ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.body);

        if (!result.success) {
            const errors = result.error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message
            }));

            res.status(400).json({
                error: 'Validation failed',
                details: errors
            });
            return;
        }

        // Replace body with validated/transformed data
        req.body = result.data;
        next();
    };
}

/**
 * Validate query parameters
 */
export function validateQuery<T extends z.ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.query);

        if (!result.success) {
            const errors = result.error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message
            }));

            res.status(400).json({
                error: 'Invalid query parameters',
                details: errors
            });
            return;
        }

        next();
    };
}

/**
 * Validate URL parameters
 */
export function validateParams<T extends z.ZodSchema>(schema: T) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req.params);

        if (!result.success) {
            res.status(400).json({
                error: 'Invalid URL parameters',
                details: result.error.errors
            });
            return;
        }

        next();
    };
}

// ============= SANITIZATION HELPERS =============

/**
 * Sanitize string to prevent XSS
 */
export function sanitizeString(str: string): string {
    return str
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .trim();
}

/**
 * Sanitize object recursively
 */
export function sanitizeObject<T extends object>(obj: T): T {
    const sanitized: any = {};

    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            sanitized[key] = sanitizeString(value);
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = Array.isArray(value)
                ? value.map(v => typeof v === 'string' ? sanitizeString(v) : v)
                : sanitizeObject(value);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
}
