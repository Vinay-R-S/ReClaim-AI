/**
 * Fetching the bytes behind an item image.
 *
 * The worker only ever has a URL: raw bytes arrive in the create request and
 * are handed to Cloudinary and dropped, so a job that runs seconds later has
 * to go and get them. That makes this an outbound fetch driven by a value read
 * out of a document, which is the shape of a server-side request forgery
 * (PLAN.md defect SEC-23), so it is constrained rather than trusted:
 *
 * - the host must be one this deployment actually uploads to, and stays that
 *   way across redirects, which is why they are followed by hand,
 * - the response must be an image,
 * - the body is read in chunks against a hard cap and abandoned the moment it
 *   is exceeded, so a lying or absent `content-length` cannot put an unbounded
 *   response on the worker's heap,
 * - and the whole thing has a timeout.
 *
 * A URL that fails any of those is skipped, not retried. It is a bad
 * reference, and asking again produces the same bad reference.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('embeddings:image-source');

/** Cloudinary's delivery hosts. Nothing else is fetched, at any hop. */
const ALLOWED_HOSTS = new Set(['res.cloudinary.com', 'cloudinary.com']);

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export function isFetchableImageUrl(value: string): boolean {
  try {
    const url = new URL(value);

    if (url.protocol !== 'https:') return false;

    return ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Read a body against the cap.
 *
 * Chunk by chunk rather than `arrayBuffer()`, because that materialises
 * whatever the far end sends before anything can object to its size.
 */
async function readCapped(response: Response): Promise<Buffer | null> {
  const body = response.body;

  if (!body) return null;

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    if (!value) continue;

    total += value.byteLength;

    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      log.warn('Image body exceeded the cap mid-read', { cap: MAX_BYTES });

      return null;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/**
 * The image bytes, or null when the reference is not one worth following.
 *
 * Null rather than a throw: one unreadable photo on an item with three should
 * not fail the item's embedding run.
 */
export async function fetchImageBytes(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let target = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      // Every hop is checked, not just the first. `fetch` follows redirects on
      // its own, which would let a stored Cloudinary URL bounce the request to
      // a host this allowlist exists to keep it away from.
      if (!isFetchableImageUrl(target)) {
        log.warn('Refusing to fetch an image from an unexpected host', { hop });

        return null;
      }

      const response = await fetch(target, {
        signal: controller.signal,
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        if (!location) {
          log.warn('Image redirect had no destination', { status: response.status });

          return null;
        }

        target = new URL(location, target).toString();
        continue;
      }

      if (!response.ok) {
        log.warn('Image fetch failed', { status: response.status });

        return null;
      }

      const type = response.headers.get('content-type') ?? '';

      if (!type.startsWith('image/')) {
        log.warn('Image URL did not answer with an image', { type });

        return null;
      }

      // A declared length over the cap is refused before the body is read at
      // all; an absent or understated one is caught by `readCapped`.
      const declared = Number(response.headers.get('content-length') ?? 0);

      if (declared > MAX_BYTES) {
        log.warn('Image is larger than the cap', { declared });

        return null;
      }

      return readCapped(response);
    }

    log.warn('Image URL redirected too many times');

    return null;
  } catch (error) {
    log.warn('Image fetch failed', { error });

    return null;
  } finally {
    clearTimeout(timer);
  }
}
