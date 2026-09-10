/**
 * The QR alternative to typing six digits (PLAN.md 10.4).
 *
 * A six-digit code has a million values, is read aloud across a table, and is
 * typed by the wrong party as often as the right one. Where both people have
 * the app open, the owner shows a token and the finder scans it: nothing is
 * spoken, nothing is typed, and the token is worth nothing a few minutes later.
 *
 * It is a signed value rather than a stored one. A stored token is another
 * document to write, expire and clean up, and another thing that can be read
 * out of the database; a signed one carries its own expiry and its own binding
 * to the handover, and verifying it is an HMAC rather than a read.
 *
 * The signature covers the handover id and the expiry together. Signing the id
 * alone would make a token for one handover valid forever; signing the expiry
 * alone would make a token for one handover valid for another.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

/** Bumped if the payload shape or the algorithm changes. */
const TOKEN_VERSION = 'v1';

export interface QrToken {
  token: string;
  expiresAt: Date;
}

export type QrFailure = 'malformed' | 'bad_signature' | 'expired' | 'wrong_handover';

export type QrVerification = { ok: true; nonce: string } | { ok: false; reason: QrFailure };

function sign(payload: string): string {
  return createHmac('sha256', env.handover.codeSecret).update(payload).digest('base64url');
}

/**
 * Mint a token for one handover.
 *
 * The nonce is what makes two tokens for the same handover in the same second
 * different from each other, so a token that has been seen cannot be
 * recognised as one that has been used.
 */
export function issueQrToken(matchId: string, now = new Date()): QrToken {
  const expiresAt = new Date(now.getTime() + env.handover.qrTtlSeconds * 1000);
  const nonce = randomBytes(9).toString('base64url');
  const payload = `${TOKEN_VERSION}.${matchId}.${expiresAt.getTime()}.${nonce}`;

  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/**
 * Check a token against the handover it claims to be for.
 *
 * The signature is checked before the expiry, and the handover id before
 * either is believed: an attacker who can change the expiry can only produce a
 * token whose signature no longer matches, and one who replays a token from a
 * different handover is refused on the id rather than on the clock.
 */
export function verifyQrToken(token: string, matchId: string, now = new Date()): QrVerification {
  const parts = token.split('.');

  if (parts.length !== 5 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'malformed' };

  const [, signedMatchId, expiry, nonce, signature] = parts;
  const payload = `${TOKEN_VERSION}.${signedMatchId}.${expiry}.${nonce}`;

  const expected = Buffer.from(sign(payload), 'utf8');
  const actual = Buffer.from(signature, 'utf8');

  if (expected.length !== actual.length) return { ok: false, reason: 'bad_signature' };
  if (!timingSafeEqual(expected, actual)) return { ok: false, reason: 'bad_signature' };

  if (signedMatchId !== matchId) return { ok: false, reason: 'wrong_handover' };

  const expiresAt = Number.parseInt(expiry, 10);

  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };
  if (expiresAt <= now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, nonce };
}

/** Whether a submitted credential is a QR token rather than six digits. */
export function looksLikeQrToken(value: string): boolean {
  return value.startsWith(`${TOKEN_VERSION}.`);
}
