/**
 * The constraints on fetching an item photo.
 *
 * This is the one place in the embedding path that makes an outbound request
 * driven by a value read out of a document (PLAN.md defect SEC-23), so what
 * matters is not that it works but that it refuses: an unexpected host, a
 * redirect off the allowlist, a body that is not an image, and a body that
 * keeps coming.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchImageBytes, isFetchableImageUrl } from './image.source.js';

const OK = 'https://res.cloudinary.com/demo/image/upload/a.jpg';

function imageResponse(body: Buffer, type = 'image/jpeg', headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': type, ...headers }),
    body: streamOf(body),
  };
}

function redirectTo(location: string, status = 302) {
  return {
    ok: false,
    status,
    headers: new Headers({ location }),
    body: null,
  };
}

function streamOf(buffer: Buffer, chunkSize = 1024): ReadableStream<Uint8Array> {
  let offset = 0;

  return new ReadableStream({
    pull(controller) {
      if (offset >= buffer.byteLength) {
        controller.close();

        return;
      }

      const end = Math.min(offset + chunkSize, buffer.byteLength);

      controller.enqueue(new Uint8Array(buffer.subarray(offset, end)));
      offset = end;
    },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isFetchableImageUrl', () => {
  it('accepts the delivery host this deployment uploads to', () => {
    expect(isFetchableImageUrl(OK)).toBe(true);
  });

  it.each([
    ['a different host', 'https://attacker.test/a.jpg'],
    ['link-local metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['plain http', 'http://res.cloudinary.com/demo/a.jpg'],
    ['a host that merely ends with the allowed one', 'https://evilcloudinary.com/a.jpg'],
    ['nonsense', 'not-a-url'],
  ])('refuses %s', (_label, url) => {
    expect(isFetchableImageUrl(url)).toBe(false);
  });
});

describe('fetchImageBytes', () => {
  it('returns the bytes for an allowed image', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse(Buffer.from('jpeg-bytes')));

    const bytes = await fetchImageBytes(OK);

    expect(bytes?.toString()).toBe('jpeg-bytes');
  });

  it('does not call out at all for a host off the allowlist', async () => {
    expect(await fetchImageBytes('https://attacker.test/a.jpg')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The finding this exists for: `fetch` follows redirects on its own, so an
   * allowlist applied to the first URL only is no allowlist at all.
   */
  it('refuses a redirect that leaves the allowlist', async () => {
    fetchMock.mockResolvedValueOnce(redirectTo('http://169.254.169.254/latest/meta-data/'));

    expect(await fetchImageBytes(OK)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('follows a redirect that stays on the allowlist', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo('https://res.cloudinary.com/demo/image/upload/b.jpg'))
      .mockResolvedValueOnce(imageResponse(Buffer.from('moved-bytes')));

    expect((await fetchImageBytes(OK))?.toString()).toBe('moved-bytes');
  });

  it('gives up rather than following a redirect loop', async () => {
    fetchMock.mockResolvedValue(redirectTo(OK));

    expect(await fetchImageBytes(OK)).toBeNull();
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('refuses a response that is not an image', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse(Buffer.from('<html>'), 'text/html'));

    expect(await fetchImageBytes(OK)).toBeNull();
  });

  it('refuses a body that declares itself over the cap', async () => {
    fetchMock.mockResolvedValueOnce(
      imageResponse(Buffer.from('small'), 'image/jpeg', {
        'content-length': String(9 * 1024 * 1024),
      }),
    );

    expect(await fetchImageBytes(OK)).toBeNull();
  });

  /**
   * The cap has to hold without a truthful `content-length`, or a body that
   * simply keeps coming lands on the worker's heap unbounded.
   */
  it('abandons a body that runs past the cap while it is being read', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse(Buffer.alloc(9 * 1024 * 1024, 1)));

    expect(await fetchImageBytes(OK)).toBeNull();
  });

  it('returns null rather than throwing when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    expect(await fetchImageBytes(OK)).toBeNull();
  });
});
