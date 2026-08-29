/**
 * Application logger.
 *
 * Single logging entry point for the server. Nothing in `src/` may call
 * `console.*` directly.
 *
 * Two layers of protection against leaking sensitive data:
 * 1. Key redaction. Any metadata key that looks sensitive (email, token,
 *    password, secret, key, code, otp, authorization, cookie, credential,
 *    phone) has its value replaced, however deeply nested.
 * 2. Value scrubbing. Free-text messages and surviving string values are
 *    scanned for email addresses, bearer tokens, and provider API keys.
 *
 * This module reads `process.env` directly and lazily, on purpose: it must be
 * usable before `config/env.ts` has parsed, so that a configuration failure can
 * still be reported.
 */

const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

export type LogLevel = (typeof LEVELS)[number];

type LogMeta = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 20;

const SENSITIVE_KEY =
  /(email|mail|token|password|passwd|secret|key|code|otp|pin|authorization|auth|cookie|session|credential|phone|mobile)/i;

/** Keys that match the sensitive pattern by accident and carry no user data. */
const SAFE_KEYS = new Set(['statuscode', 'errorcode', 'httpcode', 'countrycode', 'postalcode']);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const API_KEY_PATTERN = /\b(?:gsk|sk|pk|xai|AIza|re)[-_][A-Za-z0-9_-]{12,}\b/g;

function isPlainRecord(value: unknown): value is LogMeta {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strip identifiers out of a free-text string. Applied to every message and to
 * every string value that survived key redaction.
 */
function scrubText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `$1${REDACTED}`)
    .replace(API_KEY_PATTERN, REDACTED);
}

function redactError(error: Error): LogMeta {
  return {
    name: error.name,
    message: scrubText(error.message),
    ...(process.env.NODE_ENV === 'production' ? {} : { stack: error.stack }),
  };
}

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value);

  if (depth >= MAX_DEPTH) return '[truncated]';
  // `seen` tracks the current path, not every object visited: the same object
  // referenced twice as siblings (a lost item and its match, say) must be
  // rendered twice, and only a genuine cycle is collapsed.
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
      return items;
    }

    if (!isPlainRecord(value)) return '[unserializable]';

    const output: LogMeta = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!SAFE_KEYS.has(key.toLowerCase()) && SENSITIVE_KEY.test(key)) {
        output[key] = entry === undefined || entry === null ? entry : REDACTED;
        continue;
      }
      const cleaned = redact(entry, depth + 1, seen);
      if (cleaned !== undefined) output[key] = cleaned;
    }
    return output;
  } finally {
    seen.delete(value as object);
  }
}

function resolveLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && (LEVELS as readonly string[]).includes(configured)) {
    return configured as LogLevel;
  }
  if (process.env.NODE_ENV === 'production') return 'info';
  // Tests stay quiet but must not swallow failures.
  if (process.env.NODE_ENV === 'test') return 'error';
  return 'debug';
}

function write(
  level: Exclude<LogLevel, 'silent'>,
  scope: string | undefined,
  args: unknown[],
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[resolveLevel()]) return;

  const [first, ...rest] = args;
  const message = typeof first === 'string' ? scrubText(first) : '';
  const extras = typeof first === 'string' ? rest : args;

  const meta: LogMeta = {};
  extras.forEach((entry, index) => {
    if (isPlainRecord(entry) && !(entry instanceof Error)) {
      Object.assign(meta, redact(entry) as LogMeta);
      return;
    }
    meta[index === 0 ? 'detail' : `detail${index}`] = redact(entry);
  });

  const record = {
    timestamp: new Date().toISOString(),
    level,
    ...(scope ? { scope } : {}),
    message,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };

  // The console is the transport, and this is the only place allowed to use it.
  // eslint-disable-next-line no-console
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (process.env.NODE_ENV === 'production') {
    sink(JSON.stringify(record));
    return;
  }

  const prefix = `${record.timestamp} ${level.toUpperCase()}${scope ? ` [${scope}]` : ''}`;
  if (Object.keys(meta).length > 0) {
    sink(`${prefix} ${message}`, meta);
    return;
  }
  sink(`${prefix} ${message}`);
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (scope: string) => Logger;
}

export function createLogger(scope?: string): Logger {
  return {
    debug: (...args: unknown[]) => write('debug', scope, args),
    info: (...args: unknown[]) => write('info', scope, args),
    warn: (...args: unknown[]) => write('warn', scope, args),
    error: (...args: unknown[]) => write('error', scope, args),
    child: (childScope: string) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

export const logger = createLogger();

export default logger;
