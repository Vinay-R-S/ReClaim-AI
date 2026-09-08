/**
 * Trace context for the request.
 *
 * Runs first, so every log line written while serving the request carries the
 * same trace id, including the ones written by a job the request enqueued and
 * a worker ran an hour later. An inbound `traceparent` is joined rather than
 * replaced, which is what makes the client's own trace and the server's one
 * trace.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  continueTrace,
  formatTraceparent,
  runWithTraceContext,
} from '../platform/tracing/context.js';

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const context = continueTrace(req.header('traceparent'));

  // Echoed so a caller reporting a problem can quote the id rather than a time.
  res.setHeader('traceparent', formatTraceparent(context));

  runWithTraceContext(context, next);
}
