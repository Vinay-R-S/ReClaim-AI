/**
 * Secure Error Handler Middleware
 * - Logs detailed errors server-side
 * - Returns sanitized messages to clients
 * - Never exposes stack traces in production
 */

import { Request, Response, NextFunction } from 'express';

interface ApiError extends Error {
    statusCode?: number;
    code?: string;
}

/**
 * Custom error class for API errors
 */
export class AppError extends Error {
    statusCode: number;
    isOperational: boolean;

    constructor(message: string, statusCode: number = 500) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Global error handler middleware
 * Must be the LAST middleware in the chain
 */
export function errorHandler(
    err: ApiError,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const statusCode = err.statusCode || 500;

    // Log full error details server-side
    console.error('=== SERVER ERROR ===');
    console.error('Timestamp:', new Date().toISOString());
    console.error('Method:', req.method);
    console.error('Path:', req.path);
    console.error('Error:', err.message);
    console.error('Code:', err.code);
    if (!isProduction) {
        console.error('Stack:', err.stack);
    }
    console.error('====================');

    // Security-focused response mapping
    const safeMessages: Record<number, string> = {
        400: 'Invalid request',
        401: 'Authentication required',
        403: 'Access denied',
        404: 'Resource not found',
        429: 'Too many requests',
        500: 'Something went wrong. Please try again later.',
    };

    // In production, use safe generic messages
    // In development, show actual error message
    const clientMessage = isProduction
        ? safeMessages[statusCode] || 'An error occurred'
        : err.message;

    res.status(statusCode).json({
        error: clientMessage,
        // Only include these in development
        ...(isProduction ? {} : {
            message: err.message,
            code: err.code,
            path: req.path,
        })
    });
}

/**
 * 404 handler for undefined routes
 */
export function notFoundHandler(req: Request, res: Response): void {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path
    });
}

/**
 * Async handler wrapper to catch errors in async route handlers
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Log suspicious activity (failed logins, blocked requests)
 */
export function logSecurityEvent(
    eventType: 'failed_login' | 'blocked_request' | 'rate_limited' | 'unauthorized',
    details: {
        ip?: string;
        userId?: string;
        path?: string;
        reason?: string;
    }
): void {
    const logEntry = {
        timestamp: new Date().toISOString(),
        type: eventType,
        ...details
    };

    // In production, you might want to send this to a logging service
    console.warn('[SECURITY]', JSON.stringify(logEntry));
}
