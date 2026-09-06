import type { SerializedTimestamp } from '../types/domain';

/**
 * Every shape a timestamp reaches this client in.
 *
 * A document read through the Firestore SDK carries a `Timestamp`; the same
 * field read from the API has been through JSON and is `{ _seconds }` or
 * `{ seconds }`; a few endpoints send an ISO string, and a form sends a Date.
 */
export type TimestampLike = SerializedTimestamp | Date | string | number | null | undefined;

/**
 * Read any of those into a Date, or null when there is nothing usable.
 *
 * The screens each had their own version of this, which is why they disagreed
 * on which of `_seconds` and `seconds` to look at.
 */
export function toDate(value: TimestampLike): Date | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number') {
    const fromMillis = new Date(value);
    return Number.isNaN(fromMillis.getTime()) ? null : fromMillis;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value.toDate === 'function') return value.toDate();

  const seconds = value._seconds ?? value.seconds;
  if (typeof seconds !== 'number') return null;

  return new Date(seconds * 1000);
}

/**
 * Read a `YYYY-MM-DD` bucket key as a local date.
 *
 * `new Date('2026-09-06')` is UTC midnight, and formatting that in a timezone
 * west of UTC renders the previous day, so every chart label was off by one.
 */
export function fromDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);

  return new Date(year, (month ?? 1) - 1, day ?? 1);
}
