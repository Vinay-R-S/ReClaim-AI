/**
 * Timestamps arrive in four shapes and every screen used to guess at them
 * differently, which is how two of them disagreed on whether to read `seconds`
 * or `_seconds`.
 */

import { describe, expect, it } from 'vitest';
import { fromDayKey, toDate } from './timestamps';

describe('toDate', () => {
  it('passes a Date through', () => {
    const when = new Date(2026, 0, 2, 12, 0, 0);

    expect(toDate(when)).toBe(when);
  });

  it('rejects an invalid Date rather than propagating NaN', () => {
    expect(toDate(new Date('nonsense'))).toBeNull();
  });

  it('reads a Firestore SDK timestamp through toDate()', () => {
    const when = new Date(2026, 0, 2, 12, 0, 0);

    expect(toDate({ toDate: () => when })).toBe(when);
  });

  it('reads a serialised timestamp under either field name', () => {
    const seconds = Math.floor(Date.UTC(2026, 0, 2, 12) / 1000);

    expect(toDate({ seconds })?.getTime()).toBe(seconds * 1000);
    expect(toDate({ _seconds: seconds })?.getTime()).toBe(seconds * 1000);
  });

  it('prefers the underscored field, which is what the API sends', () => {
    expect(toDate({ _seconds: 100, seconds: 200 })?.getTime()).toBe(100_000);
  });

  it('parses an ISO string', () => {
    expect(toDate('2026-01-02T12:00:00.000Z')?.toISOString()).toBe('2026-01-02T12:00:00.000Z');
  });

  it('reads a number as milliseconds', () => {
    expect(toDate(1_767_355_200_000)?.getTime()).toBe(1_767_355_200_000);
  });

  it('returns null for nothing usable', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate({})).toBeNull();
  });
});

describe('fromDayKey', () => {
  /**
   * `new Date('2026-09-06')` is UTC midnight, and formatting that west of UTC
   * renders the previous day, which put every chart label off by one.
   */
  it('reads a day key as a local date, not a UTC instant', () => {
    const day = fromDayKey('2026-09-06');

    expect(day.getFullYear()).toBe(2026);
    expect(day.getMonth()).toBe(8); // September
    expect(day.getDate()).toBe(6);
  });

  it('is midnight local, so a date format never rolls over', () => {
    const day = fromDayKey('2026-01-01');

    expect(day.getHours()).toBe(0);
    expect(day.getMinutes()).toBe(0);
  });
});
