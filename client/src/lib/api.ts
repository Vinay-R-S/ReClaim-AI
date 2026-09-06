/**
 * The client's one way to reach the server.
 *
 * Every screen used to build its own request: ten files declared their own
 * `const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'`,
 * and each call site invented its own way of noticing a failure, so a 429, a
 * 403 and an outage were reported to the user as whatever that one caller
 * happened to check for (defect ARCH-09).
 *
 * Everything here returns parsed JSON and throws `ApiError` on a non-2xx, with
 * the status still attached for the callers that must tell one apart from
 * another: a 403 on the profile bootstrap means a blocked account, and a 404
 * on a handover status means the link is dead rather than the server.
 */

import { auth } from './firebase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/** A non-2xx response, with the status and the parsed body kept. */
export class ApiError extends Error {
  readonly status: number;

  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Get the current user's Firebase ID token, or null when signed out.
 */
export async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    // Not `getIdToken(true)`. Forcing a refresh made every single API call
    // wait on a network round trip to Google before it could start; the SDK
    // already refreshes a token that is expired or close to it (defect
    // PERF-08).
    return await user.getIdToken();
  } catch (error) {
    console.error('Failed to get auth token:', error);
    return null;
  }
}

function resolveUrl(endpoint: string): string {
  return endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
}

async function buildHeaders(authenticated: boolean): Promise<Headers> {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');

  if (!authenticated) return headers;

  const token = await getAuthToken();
  if (!token) throw new Error('Authentication required. Please sign in.');

  headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

async function parse<T>(response: Response): Promise<T> {
  // 204 and an empty body are success with nothing to read.
  const text = await response.text();

  // The status decides, not the body. The API always answers in JSON, but a
  // proxy in front of it does not: a 413 on an image upload or a 502 comes
  // back as HTML, and parsing that first would throw a SyntaxError and lose
  // the status that `getStatus` and the profile bootstrap branch on.
  let body: unknown = null;
  let parsed = true;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      parsed = false;
      body = text;
    }
  }

  if (response.ok) {
    if (!parsed) throw new ApiError(response.status, 'The server sent an unreadable reply', body);
    return body as T;
  }

  const envelope = parsed
    ? (body as { error?: string; message?: string; details?: string } | null)
    : null;
  const message =
    envelope?.error ??
    envelope?.message ??
    envelope?.details ??
    `Request failed with status ${response.status}`;

  throw new ApiError(response.status, message, body);
}

interface RequestOptions {
  /** Send the caller's ID token. Default true. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  endpoint: string,
  data: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const { authenticated = true, signal } = options;
  const headers = await buildHeaders(authenticated);

  const response = await fetch(resolveUrl(endpoint), {
    method,
    headers,
    signal,
    body: data === undefined ? undefined : JSON.stringify(data),
  });

  return parse<T>(response);
}

export function authGet<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  return request<T>('GET', endpoint, undefined, options);
}

export function authPost<T>(
  endpoint: string,
  data?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>('POST', endpoint, data ?? {}, options);
}

export function authPut<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PUT', endpoint, data ?? {}, options);
}

export function authDelete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  return request<T>('DELETE', endpoint, undefined, options);
}

/** The same helpers for the endpoints that are public by design. */
export function apiGet<T>(endpoint: string): Promise<T> {
  return request<T>('GET', endpoint, undefined, { authenticated: false });
}

export function apiPost<T>(endpoint: string, data?: unknown): Promise<T> {
  return request<T>('POST', endpoint, data ?? {}, { authenticated: false });
}

/** An error carrying the handover check that refused, when the server named one. */
export type ErrorWithCriteria = Error & { criteriaFailure?: string };

/**
 * Lift `criteriaFailure` out of a refusal body onto the error itself.
 *
 * Which handover check refused is a decision the admin can override, so it has
 * to survive to the screen rather than being flattened into the message.
 */
export function withCriteriaFailure(error: unknown): unknown {
  if (!isApiError(error)) return error;

  const failure = (error.body as { criteriaFailure?: string } | null)?.criteriaFailure;
  if (failure) (error as ErrorWithCriteria).criteriaFailure = failure;

  return error;
}
