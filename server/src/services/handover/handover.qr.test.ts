/**
 * The QR token.
 *
 * It stands in for a six-digit code, so it is a credential, and the tests are
 * about the ways a credential goes wrong: forged, replayed against a different
 * handover, or presented after it should have stopped working.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env.js', () => ({
  env: { handover: { codeSecret: 'a-test-secret-that-is-long-enough', qrTtlSeconds: 120 } },
}));

const { issueQrToken, looksLikeQrToken, verifyQrToken } = await import('./handover.qr.js');

const NOW = new Date('2026-09-10T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('issueQrToken', () => {
  it('expires at the configured distance from now', () => {
    const { expiresAt } = issueQrToken('match-1', NOW);

    expect(expiresAt.getTime() - NOW.getTime()).toBe(120_000);
  });

  it('mints a different token each time, so a seen token is not a used token', () => {
    const first = issueQrToken('match-1', NOW);
    const second = issueQrToken('match-1', NOW);

    expect(first.token).not.toBe(second.token);
  });

  it('produces something the verifier recognises as a token rather than a code', () => {
    expect(looksLikeQrToken(issueQrToken('match-1', NOW).token)).toBe(true);
    expect(looksLikeQrToken('123456')).toBe(false);
  });
});

describe('verifyQrToken', () => {
  it('accepts its own token for its own handover', () => {
    const { token } = issueQrToken('match-1', NOW);

    expect(verifyQrToken(token, 'match-1', NOW)).toMatchObject({ ok: true });
  });

  it('refuses a token replayed against a different handover', () => {
    const { token } = issueQrToken('match-1', NOW);

    expect(verifyQrToken(token, 'match-2', NOW)).toEqual({ ok: false, reason: 'wrong_handover' });
  });

  it('refuses a token past its expiry', () => {
    const { token } = issueQrToken('match-1', NOW);
    const later = new Date(NOW.getTime() + 121_000);

    expect(verifyQrToken(token, 'match-1', later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a token whose expiry has been pushed out', () => {
    // The signature covers the expiry, so extending it invalidates the token
    // rather than extending its life.
    const { token } = issueQrToken('match-1', NOW);
    const [version, matchId, , nonce, signature] = token.split('.');
    const forged = [version, matchId, NOW.getTime() + 86_400_000, nonce, signature].join('.');

    expect(verifyQrToken(forged, 'match-1', NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a token whose handover has been swapped', () => {
    const { token } = issueQrToken('match-1', NOW);
    const [version, , expiry, nonce, signature] = token.split('.');
    const forged = [version, 'match-2', expiry, nonce, signature].join('.');

    expect(verifyQrToken(forged, 'match-2', NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a signature that is simply wrong', () => {
    const { token } = issueQrToken('match-1', NOW);
    const parts = token.split('.');

    parts[4] = 'not-the-signature';

    expect(verifyQrToken(parts.join('.'), 'match-1', NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('refuses anything that is not shaped like a token', () => {
    expect(verifyQrToken('123456', 'match-1', NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyQrToken('', 'match-1', NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyQrToken('v2.a.b.c.d', 'match-1', NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('checks the signature before the clock', () => {
    // Otherwise an expired token reports `expired` whether or not it was
    // genuine, which tells a forger their signature was accepted.
    const { token } = issueQrToken('match-1', NOW);
    const parts = token.split('.');

    parts[4] = 'not-the-signature';

    const later = new Date(NOW.getTime() + 86_400_000);

    expect(verifyQrToken(parts.join('.'), 'match-1', later)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});
