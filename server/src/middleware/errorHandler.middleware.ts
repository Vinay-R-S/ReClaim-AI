/**
 * Secure Error Handler Middleware
 * - Logs detailed errors server-side
 * - Returns sanitized messages to clients
 * - Never exposes stack traces in production
 */

import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('http');

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
  details?: Record<string, unknown>;
}

/**
 * An error a service raises deliberately, with the status it should answer.
 *
 * `isOperational` is what separates "the caller asked for something we refuse"
 * from "something broke". A refusal is written for the caller to read, so its
 * message is sent as-is; anything else is sanitised below.
 */
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  /**
   * Extra fields the caller needs alongside the message, merged into the
   * response body. The admin match screen needs to know which handover check
   * refused, not only that one did, so that it can offer the override.
   */
  details?: Record<string, unknown>;

  constructor(message: string, statusCode: number = 500, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
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
  _next: NextFunction,
): void {
  const isProduction = env.isProduction;
  const statusCode = err.statusCode || 500;

  // Every route is asyncHandler-wrapped, so a handler that already responded
  // and then rejected lands here. Writing again would throw ERR_HTTP_HEADERS_SENT
  // from inside the error handler itself.
  if (res.headersSent) {
    log.error('Request failed after the response was sent', {
      method: req.method,
      path: req.path,
      error: err,
    });
    _next(err);
    return;
  }

  // Log full error details server-side. The logger redacts identifiers and
  // drops stack traces in production.
  log.error('Request failed', {
    method: req.method,
    path: req.path,
    statusCode,
    errorCode: err.code,
    error: err,
  });

  // Security-focused response mapping
  const safeMessages: Record<number, string> = {
    400: 'Invalid request',
    401: 'Authentication required',
    403: 'Access denied',
    404: 'Resource not found',
    429: 'Too many requests',
    500: 'Something went wrong. Please try again later.',
  };

  // A deliberate 4xx keeps its message in every environment: "Item is already
  // approved" and "You can only edit your own reports" are the answer, and
  // replacing them with "Invalid request" tells the caller nothing. Everything
  // else, and every 5xx, is sanitised in production.
  const isClientRefusal = err.isOperational === true && statusCode < 500;

  const clientMessage =
    isProduction && !isClientRefusal
      ? safeMessages[statusCode] || 'An error occurred'
      : err.message;

  res.status(statusCode).json({
    // Development diagnostics first, so a refusal's own fields win over them
    // and the same request answers identically in every environment.
    ...(isProduction
      ? {}
      : {
          message: err.message,
          code: err.code,
          path: req.path,
        }),
    // A refusal may carry fields the caller acts on. Only for a deliberate
    // 4xx: nothing internal is ever attached this way.
    ...(isClientRefusal && err.details ? err.details : {}),
    // Last, so `error` is always the message and never a detail key.
    error: clientMessage,
  });
}

/**
 * 404 handler for undefined routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
  });
}

/**
 * Async handler wrapper to catch errors in async route handlers
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
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
  },
): void {
  log.warn('Security event', { type: eventType, ...details });
}
