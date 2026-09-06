/**
 * Building blocks shared by every request schema
 */

import { z } from 'zod';

// Text is cleaned rather than HTML encoded here: escaping happens at output,
// so a value stays correct in JSON, in the UI and in email alike.

function stripControls(value: string, keepLineBreaks: boolean): string {
  // Drop C0 controls and DEL. Tab always survives; line breaks survive only in
  // fields that are genuinely multi-line. These characters carry no meaning in
  // stored text and only serve to smuggle a payload past a log line, a
  // template, or an email header.
  return Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code === 9) return true;
      if (code === 10 || code === 13) return keepLineBreaks;
      return code > 31 && code !== 127;
    })
    .join('');
}

/**
 * Clean a single-line value: no control characters, no line breaks
 */
export function cleanText(value: string): string {
  return stripControls(value, false).trim();
}

/**
 * Clean a multi-line value, keeping the line breaks
 */
export function cleanMultilineText(value: string): string {
  return stripControls(value, true).trim();
}

/**
 * Required single-line text, cleaned then length checked
 */
export function text(min: number, max: number) {
  return z
    .string()
    .max(max, `Must be at most ${max} characters`)
    .transform(cleanText)
    .pipe(z.string().min(min, `Must be at least ${min} characters`));
}

/**
 * Optional single-line text. An empty string stays valid because several forms
 * submit unset fields as ''.
 */
export function optionalText(max: number) {
  return z.string().max(max, `Must be at most ${max} characters`).transform(cleanText).optional();
}

/**
 * Required multi-line text, cleaned then length checked
 */
export function multilineText(min: number, max: number) {
  return z
    .string()
    .max(max, `Must be at most ${max} characters`)
    .transform(cleanMultilineText)
    .pipe(z.string().min(min, `Must be at least ${min} characters`));
}

/**
 * Optional multi-line text, empty string allowed
 */
export function optionalMultilineText(max: number) {
  return z
    .string()
    .max(max, `Must be at most ${max} characters`)
    .transform(cleanMultilineText)
    .optional();
}

export const idString = z.string().min(1, 'Required').max(128, 'Too long');

export const isoDateString = z
  .string()
  .min(1, 'Date is required')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid date');

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const emailString = z.string().email('Invalid email format').max(255, 'Email too long');

/**
 * Base64 payload (data URL or bare base64). The upload service checks the
 * content, this only bounds the shape.
 */
/**
 * A page cursor: the id of the last document on the previous page.
 *
 * Constrained to one path segment. `?cursor=a/b` reaches `collection.doc()` as
 * a two-segment path, which the Admin SDK rejects with a throw rather than a
 * refusal, so it surfaced as a 500.
 */
export const cursorString = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid cursor');

export const imagePayload = z.string().min(1, 'Image data required');

export const idParamsSchema = z.object({ id: idString });

export const userIdParamsSchema = z.object({ userId: idString });

export const itemIdParamsSchema = z.object({ itemId: idString });

export const matchIdParamsSchema = z.object({ matchId: idString });
