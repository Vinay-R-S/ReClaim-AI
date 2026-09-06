/**
 * The one API layer.
 *
 * Two things here are worth pinning. The version prefix is added in exactly
 * one place, so a mistake in it silently redirects every call in the app
 * (ARCH-19). And the status is read before the body is trusted to be JSON,
 * which is the phase 13 defect: a 500 with an HTML error page used to surface
 * as a parse failure rather than as the outage it was.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const currentUser = { getIdToken: vi.fn() };

vi.mock('./firebase', () => ({
  auth: {
    get currentUser() {
      return currentUser.getIdToken.getMockImplementation() ? currentUser : null;
    },
  },
}));

const { ApiError, apiGet, authGet, authPost } = await import('./api');

const fetchMock = vi.fn();

function respond(body: unknown, init: { status?: number; text?: string } = {}) {
  const status = init.status ?? 200;

  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => init.text ?? JSON.stringify(body),
  } as Response;
}

function calledUrl(): string {
  return fetchMock.mock.calls[0][0] as string;
}

function calledHeaders(): Headers {
  return (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
}

beforeEach(() => {
  fetchMock.mockReset();
  currentUser.getIdToken.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the request URL', () => {
  it('ARCH-19 sends an /api path to the versioned mount', async () => {
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await apiGet('/api/settings/mode');

    expect(calledUrl()).toBe('http://localhost:3001/api/v1/settings/mode');
  });

  it('versions a path with parameters and a query string too', async () => {
    fetchMock.mockResolvedValue(respond({ items: [] }));

    await apiGet('/api/items?type=Lost&limit=10');

    expect(calledUrl()).toBe('http://localhost:3001/api/v1/items?type=Lost&limit=10');
  });

  it('leaves a path that already carries a version alone', async () => {
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await apiGet('/api/v1/settings/mode');

    expect(calledUrl()).toBe('http://localhost:3001/api/v1/settings/mode');
  });

  it('reads the version as a segment, so a future v10 cannot mangle a v1 path', async () => {
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await apiGet('/api/v10/settings/mode');

    expect(calledUrl()).toBe('http://localhost:3001/api/v10/settings/mode');
  });

  it('versions a path that only looks versioned', async () => {
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await apiGet('/api/verify-thing');

    expect(calledUrl()).toBe('http://localhost:3001/api/v1/verify-thing');
  });

  it('leaves an absolute URL alone', async () => {
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await apiGet('https://example.com/api/thing');

    expect(calledUrl()).toBe('https://example.com/api/thing');
  });
});

describe('authentication', () => {
  it('sends the ID token as a bearer', async () => {
    currentUser.getIdToken.mockResolvedValue('token-123');
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await authGet('/api/users');

    expect(calledHeaders().get('Authorization')).toBe('Bearer token-123');
  });

  it('refuses to send an authenticated request while signed out', async () => {
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await expect(authGet('/api/users')).rejects.toThrow(/sign in/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no Authorization header on a public endpoint', async () => {
    fetchMock.mockResolvedValue(respond({ ok: true }));

    await apiGet('/api/settings/mode');

    expect(calledHeaders().get('Authorization')).toBeNull();
  });
});

describe('the response', () => {
  it('returns the parsed body on success', async () => {
    fetchMock.mockResolvedValue(respond({ items: [{ id: 'a' }] }));

    await expect(apiGet('/api/items')).resolves.toEqual({ items: [{ id: 'a' }] });
  });

  it('throws ApiError with the status on a refusal', async () => {
    fetchMock.mockResolvedValue(respond({ error: 'Blocked' }, { status: 403 }));

    await expect(apiGet('/api/items')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      message: 'Blocked',
    });
  });

  it('keeps the body, so a caller can read the fields a refusal carries', async () => {
    currentUser.getIdToken.mockResolvedValue('token-123');
    fetchMock.mockResolvedValue(
      respond(
        { error: 'Handover criteria not met', criteriaFailure: 'Date mismatch' },
        { status: 400 },
      ),
    );

    const error = await authPost('/api/matches/verify', {}).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).body).toMatchObject({
      criteriaFailure: 'Date mismatch',
    });
  });

  it('reports an unreadable success body as a failure, not as data', async () => {
    fetchMock.mockResolvedValue(respond(null, { text: '<html>proxy error</html>' }));

    await expect(apiGet('/api/items')).rejects.toMatchObject({ name: 'ApiError' });
  });

  it('reports an unreadable error body with its own status', async () => {
    fetchMock.mockResolvedValue(respond(null, { status: 502, text: '<html>bad gateway</html>' }));

    await expect(apiGet('/api/items')).rejects.toMatchObject({ status: 502 });
  });
});
