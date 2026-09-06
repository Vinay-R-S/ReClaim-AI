/**
 * Scoring is the part of the system with the subtlest bugs, because a wrong
 * number here does not throw: it quietly reunites the wrong two people, or
 * fails to reunite the right ones.
 *
 * Every tier is tested at its boundary rather than in its middle. A tier that
 * reads `<=` where it should read `<` passes any test that samples the middle.
 */

import { describe, expect, it } from 'vitest';
import {
  LOCATION_TEXT_MAX_SCORE,
  MATCH_CONFIG,
  calculateColorScore,
  calculateLocationScore,
  calculateTimeDifference,
  calculateTimeScore,
  getTagsWithFallback,
  haversineDistance,
} from './scoring.js';

/** Bangalore, as a fixed point to measure from. */
const ORIGIN = { lat: 12.9716, lng: 77.5946 };

/**
 * A point `km` east of the origin.
 *
 * One degree of longitude is 111.32 km at the equator and shrinks by the
 * cosine of the latitude, which is what makes this land where it should.
 */
function eastOf(km: number): { lat: number; lng: number } {
  const kmPerDegree = 111.32 * Math.cos((ORIGIN.lat * Math.PI) / 180);

  return { lat: ORIGIN.lat, lng: ORIGIN.lng + km / kmPerDegree };
}

function hoursAfter(hours: number): Date {
  return new Date(Date.UTC(2026, 0, 2, 12, 0, 0) + hours * 60 * 60 * 1000);
}

const BASE_TIME = hoursAfter(0);

describe('MATCH_CONFIG', () => {
  it('weights sum to 100, which is what makes a score a percentage', () => {
    const total = Object.values(MATCH_CONFIG.WEIGHTS).reduce((sum, weight) => sum + weight, 0);

    expect(total).toBe(100);
  });

  it('the threshold is reachable and not free', () => {
    expect(MATCH_CONFIG.THRESHOLD).toBeGreaterThan(0);
    expect(MATCH_CONFIG.THRESHOLD).toBeLessThan(100);
  });

  it('the location tiers ascend and end at the pre-filter distance', () => {
    const { tier1, tier2, tier3, tier4, maxDistance } = MATCH_CONFIG.LOCATION;

    expect(tier1).toBeLessThan(tier2);
    expect(tier2).toBeLessThan(tier3);
    expect(tier3).toBeLessThan(tier4);
    expect(tier4).toBe(maxDistance);
    expect(maxDistance).toBe(MATCH_CONFIG.REQUIREMENTS.maxDistance);
  });

  it('the time tiers ascend and end at the pre-filter window', () => {
    const { tier1, tier2, tier3, maxHours } = MATCH_CONFIG.TIME;

    expect(tier1).toBeLessThan(tier2);
    expect(tier2).toBeLessThan(tier3);
    expect(tier3).toBe(maxHours);
    expect(maxHours).toBe(MATCH_CONFIG.REQUIREMENTS.maxTimeDiff);
  });
});

describe('haversineDistance', () => {
  it('is zero for the same point', () => {
    expect(haversineDistance(ORIGIN.lat, ORIGIN.lng, ORIGIN.lat, ORIGIN.lng)).toBe(0);
  });

  it('measures a known separation', () => {
    const target = eastOf(10);

    expect(haversineDistance(ORIGIN.lat, ORIGIN.lng, target.lat, target.lng)).toBeCloseTo(10, 1);
  });

  it('is symmetric', () => {
    const target = eastOf(3);
    const there = haversineDistance(ORIGIN.lat, ORIGIN.lng, target.lat, target.lng);
    const back = haversineDistance(target.lat, target.lng, ORIGIN.lat, ORIGIN.lng);

    expect(there).toBeCloseTo(back, 6);
  });
});

describe('calculateLocationScore', () => {
  const { tier1, tier2, tier3, tier4 } = MATCH_CONFIG.LOCATION;

  it.each([
    ['at the first tier boundary', tier1, 15],
    ['just past the first tier', tier1 + 0.05, 12],
    ['at the second tier boundary', tier2, 12],
    ['just past the second tier', tier2 + 0.05, 8],
    ['at the third tier boundary', tier3, 8],
    ['just past the third tier', tier3 + 0.05, 5],
    ['at the fourth tier boundary', tier4, 5],
  ])('scores %s (%s km) as %i', (_label, km, expected) => {
    expect(calculateLocationScore(ORIGIN, eastOf(km))).toBe(expected);
  });

  it('scores zero beyond the maximum distance, which is a hard fail', () => {
    expect(calculateLocationScore(ORIGIN, eastOf(tier4 + 1))).toBe(0);
  });

  it('never exceeds its share of the weights', () => {
    expect(calculateLocationScore(ORIGIN, ORIGIN)).toBe(MATCH_CONFIG.WEIGHTS.location);
  });

  it('falls back to the text when either side has no coordinates', () => {
    expect(calculateLocationScore(undefined, undefined, 'College Canteen', 'College Canteen')).toBe(
      LOCATION_TEXT_MAX_SCORE,
    );
  });

  it('scores a partial text overlap below an exact one', () => {
    const partial = calculateLocationScore(
      undefined,
      undefined,
      'Rajarajeshwari Nagar',
      'Rajarajeshwari Nagar, Bengaluru',
    );

    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(LOCATION_TEXT_MAX_SCORE);
  });

  it('ignores short words, so "the" is not an overlap', () => {
    expect(calculateLocationScore(undefined, undefined, 'the gate', 'the road')).toBe(0);
  });

  it('scores zero when there is neither a coordinate nor a name', () => {
    expect(calculateLocationScore()).toBe(0);
  });

  it('prefers coordinates over the text, so two names cannot beat a real distance', () => {
    // Same words on both sides, but 20km apart: the distance decides.
    const far = calculateLocationScore(ORIGIN, eastOf(20), 'College Canteen', 'College Canteen');

    expect(far).toBe(0);
  });
});

describe('calculateTimeScore', () => {
  const { tier1, tier2, tier3 } = MATCH_CONFIG.TIME;

  it.each([
    ['the same moment', 0, 10],
    ['at the first tier boundary', tier1, 10],
    ['just past the first tier', tier1 + 0.5, 7],
    ['at the second tier boundary', tier2, 7],
    ['just past the second tier', tier2 + 0.5, 5],
    ['at the third tier boundary', tier3, 5],
  ])('scores %s (%s hours) as %i', (_label, hours, expected) => {
    expect(calculateTimeScore(BASE_TIME, hoursAfter(hours))).toBe(expected);
  });

  it('scores zero beyond the window', () => {
    expect(calculateTimeScore(BASE_TIME, hoursAfter(tier3 + 1))).toBe(0);
  });

  it('does not care which report came first', () => {
    const forward = calculateTimeScore(BASE_TIME, hoursAfter(5));
    const backward = calculateTimeScore(hoursAfter(5), BASE_TIME);

    expect(forward).toBe(backward);
  });

  it('never exceeds its share of the weights', () => {
    expect(calculateTimeScore(BASE_TIME, BASE_TIME)).toBe(MATCH_CONFIG.WEIGHTS.time);
  });
});

describe('calculateTimeDifference', () => {
  it('is an absolute number of hours', () => {
    expect(calculateTimeDifference(BASE_TIME, hoursAfter(6))).toBeCloseTo(6, 6);
    expect(calculateTimeDifference(hoursAfter(6), BASE_TIME)).toBeCloseTo(6, 6);
  });
});

describe('calculateColorScore', () => {
  it('gives the full weight to an exact match', () => {
    expect(calculateColorScore('Black', 'black')).toBe(MATCH_CONFIG.WEIGHTS.color);
  });

  it('ignores surrounding whitespace', () => {
    expect(calculateColorScore('  Red  ', 'red')).toBe(MATCH_CONFIG.WEIGHTS.color);
  });

  it('gives a similar colour less than an exact one, and more than nothing', () => {
    const similar = calculateColorScore('black', 'charcoal');

    expect(similar).toBeGreaterThan(0);
    expect(similar).toBeLessThan(MATCH_CONFIG.WEIGHTS.color);
  });

  it('scores unrelated colours as zero', () => {
    expect(calculateColorScore('black', 'yellow')).toBe(0);
  });

  it('scores zero when either side has no colour', () => {
    expect(calculateColorScore(undefined, 'black')).toBe(0);
    expect(calculateColorScore('black', undefined)).toBe(0);
    expect(calculateColorScore('', '')).toBe(0);
  });
});

describe('getTagsWithFallback', () => {
  it('lowercases and de-duplicates what it is given', () => {
    expect(getTagsWithFallback(['Blue', 'blue', ' BLUE '])).toEqual(['blue']);
  });

  it('mines the name for tags, so an item with none is still matchable', () => {
    const tags = getTagsWithFallback([], 'Black Leather Wallet');

    expect(tags).toEqual(expect.arrayContaining(['black', 'leather', 'wallet']));
  });

  it('keeps two-letter words, which are model names more often than noise', () => {
    expect(getTagsWithFallback([], 'Mi TV Remote')).toEqual(
      expect.arrayContaining(['mi', 'tv', 'remote']),
    );
  });

  it('drops single characters', () => {
    expect(getTagsWithFallback([], 'a b phone')).not.toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('returns an empty list rather than throwing on nothing at all', () => {
    expect(getTagsWithFallback()).toEqual([]);
  });
});
