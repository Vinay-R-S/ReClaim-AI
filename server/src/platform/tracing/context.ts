/**
 * Ambient trace context.
 *
 * One correlation id follows a unit of work across every await, out through
 * the outbox, into the queue, and on into the worker process. Without it a log
 * line written six layers down names nothing, and a job failure cannot be tied
 * back to the request that produced it.
 *
 * The wire format is W3C `traceparent`, because it is what an upstream caller
 * may already be sending and what a queue payload can carry unchanged. This
 * module deliberately depends on nothing: the logger imports it, so anything
 * it imported would be pulled into every process before configuration parses.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export interface TraceContext {
  /** 32 lowercase hex characters, stable for the whole unit of work. */
  traceId: string;
  /** 16 lowercase hex characters, one per hop. */
  spanId: string;
}

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

const storage = new AsyncLocalStorage<TraceContext>();

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function createTraceContext(traceId: string = hex(16)): TraceContext {
  return { traceId, spanId: hex(8) };
}

/**
 * Parse an inbound `traceparent`.
 *
 * Only version `00` is accepted, and the all-zero ids the spec calls invalid
 * are rejected: a caller that sends one is not offering a trace to join.
 */
export function parseTraceparent(header: string | undefined): TraceContext | null {
  if (!header) return null;

  const match = TRACEPARENT_PATTERN.exec(header.trim().toLowerCase());

  if (!match) return null;

  const [, traceId, spanId] = match;

  if (traceId === ZERO_TRACE_ID || spanId === ZERO_SPAN_ID) return null;

  return { traceId, spanId };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-01`;
}

/**
 * Continue an existing trace in a new hop.
 *
 * The trace id is kept so the whole chain groups together; the span id is new,
 * so the hop can be told apart from its parent.
 */
export function continueTrace(header: string | undefined): TraceContext {
  const parent = parseTraceparent(header);

  return parent ? createTraceContext(parent.traceId) : createTraceContext();
}

export function runWithTraceContext<T>(context: TraceContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

/** The current trace id, or a new one when there is no ambient context. */
export function currentTraceparent(): string {
  const context = getTraceContext();

  return formatTraceparent(context ?? createTraceContext());
}
