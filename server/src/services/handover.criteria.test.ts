/**
 * The handover criteria decide whether the server will email a stranger a
 * six-digit code that hands over someone else's property. Each rule is tested
 * at its boundary, and each failure is tested for saying which rule refused,
 * because that string is what the admin override screen shows.
 */

import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { HANDOVER_CONFIG, validateHandoverCriteria } from './handover.criteria.js';
import type { Item } from '../types/index.js';

const ORIGIN = { lat: 12.9716, lng: 77.5946 };

/** A point `metres` east of the origin. */
function eastOf(metres: number): { lat: number; lng: number } {
  const metresPerDegree = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

  return { lat: ORIGIN.lat, lng: ORIGIN.lng + metres / metresPerDegree };
}

function at(hour: number, minute = 0): Date {
  return new Date(2026, 0, 2, hour, minute, 0);
}

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    name: 'Black wallet',
    description: 'A black leather wallet',
    type: 'Lost',
    status: 'Pending',
    location: 'College Canteen',
    coordinates: ORIGIN,
    date: at(12),
    reportedBy: 'user-1',
    ...overrides,
  } as Item;
}

describe('validateHandoverCriteria', () => {
  it('accepts a pair reported in the same place at the same time', () => {
    expect(validateHandoverCriteria(item(), item({ type: 'Found' }))).toBeNull();
  });

  describe('location', () => {
    it('accepts a pair inside the radius', () => {
      const metres = HANDOVER_CONFIG.LOCATION_RADIUS_KM * 1000;
      const found = item({ type: 'Found', coordinates: eastOf(metres - 50) });

      expect(validateHandoverCriteria(item(), found)).toBeNull();
    });

    /**
     * The boundary itself. Sampling either side of it leaves `>` and `>=`
     * indistinguishable, which is the one mistake this rule can make.
     */
    it('accepts a pair exactly on the radius', () => {
      const found = item({
        type: 'Found',
        coordinates: eastOf(HANDOVER_CONFIG.LOCATION_RADIUS_KM * 1000),
      });

      expect(validateHandoverCriteria(item(), found)).toBeNull();
    });

    it('refuses a pair one metre past it', () => {
      const found = item({
        type: 'Found',
        coordinates: eastOf(HANDOVER_CONFIG.LOCATION_RADIUS_KM * 1000 + 1),
      });

      expect(validateHandoverCriteria(item(), found)).toMatch(/Location mismatch/);
    });

    it('refuses a pair outside the radius, and says how far apart they are', () => {
      const metres = HANDOVER_CONFIG.LOCATION_RADIUS_KM * 1000;
      const found = item({ type: 'Found', coordinates: eastOf(metres + 200) });

      const failure = validateHandoverCriteria(item(), found);

      expect(failure).toMatch(/Location mismatch/);
      expect(failure).toMatch(/km apart/);
    });

    /**
     * Without coordinates the typed location is the only evidence, and equal
     * text is the only thing that can be checked. Anything else is
     * unverifiable, which is a refusal rather than a pass.
     */
    it('accepts identical typed locations when a coordinate is missing', () => {
      const lost = item({ coordinates: undefined });
      const found = item({ type: 'Found', coordinates: undefined });

      expect(validateHandoverCriteria(lost, found)).toBeNull();
    });

    it('ignores case and surrounding space in the typed location', () => {
      const lost = item({ coordinates: undefined, location: '  College Canteen ' });
      const found = item({ type: 'Found', coordinates: undefined, location: 'college canteen' });

      expect(validateHandoverCriteria(lost, found)).toBeNull();
    });

    it('refuses differing typed locations when a coordinate is missing', () => {
      const lost = item({ coordinates: undefined, location: 'Library' });
      const found = item({ type: 'Found', coordinates: undefined, location: 'Car park' });

      expect(validateHandoverCriteria(lost, found)).toMatch(/Location cannot be verified/);
    });

    it('refuses when only one side has coordinates and the names differ', () => {
      const found = item({ type: 'Found', coordinates: undefined, location: 'Car park' });

      expect(validateHandoverCriteria(item(), found)).toMatch(/Location cannot be verified/);
    });
  });

  describe('date', () => {
    it('refuses a pair reported on different days', () => {
      const found = item({ type: 'Found', date: new Date(2026, 0, 3, 12, 0, 0) });

      expect(validateHandoverCriteria(item(), found)).toMatch(/Date mismatch/);
    });

    it('refuses when either report has no date', () => {
      const undated = item({ type: 'Found', date: undefined as unknown as Date });

      expect(validateHandoverCriteria(item(), undated)).toMatch(/Date missing/);
      expect(validateHandoverCriteria(undated, item())).toMatch(/Date missing/);
    });

    it('reads a Firestore timestamp as well as a Date', () => {
      const found = item({ type: 'Found', date: Timestamp.fromDate(at(12)) });

      expect(validateHandoverCriteria(item(), found)).toBeNull();
    });
  });

  describe('time window', () => {
    const window = HANDOVER_CONFIG.TIME_WINDOW_HOURS;

    it('accepts a pair at the edge of the window', () => {
      const found = item({ type: 'Found', date: at(12 + window) });

      expect(validateHandoverCriteria(item(), found)).toBeNull();
    });

    it('refuses a pair just outside it, and says how far apart they are', () => {
      const found = item({ type: 'Found', date: at(12 + window, 30) });

      const failure = validateHandoverCriteria(item(), found);

      expect(failure).toMatch(/Time mismatch/);
      expect(failure).toMatch(/hours apart/);
    });

    it('does not care which report came first', () => {
      const early = item({ date: at(10) });
      const late = item({ type: 'Found', date: at(11) });

      expect(validateHandoverCriteria(early, late)).toBeNull();
      expect(validateHandoverCriteria(late, early)).toBeNull();
    });
  });

  describe('order of refusal', () => {
    /**
     * Location is checked first, so a pair that fails several rules reports the
     * location. The admin only sees one reason, so it has to be a stable one.
     */
    it('reports the location when several rules fail at once', () => {
      const found = item({
        type: 'Found',
        coordinates: eastOf(5000),
        date: new Date(2026, 5, 5, 3, 0, 0),
      });

      expect(validateHandoverCriteria(item(), found)).toMatch(/Location mismatch/);
    });
  });
});

describe('HANDOVER_CONFIG', () => {
  it('caps the attempts a guesser gets', () => {
    expect(HANDOVER_CONFIG.MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(HANDOVER_CONFIG.MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });

  it('expires a code rather than letting it stand forever', () => {
    expect(HANDOVER_CONFIG.CODE_EXPIRY_DAYS).toBeGreaterThan(0);
  });

  /**
   * The handover radius is deliberately far tighter than the matching radius:
   * matching proposes a pair, this hands over the property.
   */
  it('is stricter about location than matching is', () => {
    expect(HANDOVER_CONFIG.LOCATION_RADIUS_KM).toBeLessThan(1);
  });
});
