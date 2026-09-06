/**
 * Whether a pair may be handed over, and the settings that decide it.
 *
 * Separate from `handover.service.ts` because it is pure: no Firestore, no
 * email, no blockchain. That is what lets it be tested directly, and these are
 * the rules standing between a matching score and the server emailing a
 * stranger a code that hands over someone else's property.
 */

import { calculateTimeDifference, haversineDistance } from '../utils/scoring.js';
import type { Item } from '../types/index.js';

export const HANDOVER_CONFIG = {
  MAX_ATTEMPTS: 3,
  CODE_EXPIRY_DAYS: 7,
  LOCATION_RADIUS_KM: 0.6, // 600 meters
  TIME_WINDOW_HOURS: 2, // +/- 2 hours
};

/**
 * Read whatever a date field holds.
 *
 * A report date arrives as a Firestore `Timestamp` from a document, a `Date`
 * from a service call, or a string from a request that has been through JSON.
 */
export function toDate(val: unknown): Date | null {
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;

  if (val && typeof val === 'object') {
    const candidate = val as { toDate?: () => Date; seconds?: number };

    if (typeof candidate.toDate === 'function') {
      const converted = candidate.toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }

    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000);
  }

  if (typeof val === 'string' || typeof val === 'number') {
    const parsed = new Date(val);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function sameLocationText(a?: string, b?: string): boolean {
  if (!a || !b) return false;

  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Check the strict handover criteria.
 *
 * Returns the reason it refused, or null when the pair passes. The reason is
 * shown to the admin, who may override it deliberately; a generic refusal
 * would make that decision blind.
 *
 * These are far stricter than the matching thresholds on purpose. Matching
 * proposes a pair; this hands over the property.
 */
export function validateHandoverCriteria(lostItem: Item, foundItem: Item): string | null {
  const radiusMetres = Math.round(HANDOVER_CONFIG.LOCATION_RADIUS_KM * 1000);

  // 1. Location, by coordinates when both sides have them
  if (lostItem.coordinates && foundItem.coordinates) {
    const dist = haversineDistance(
      lostItem.coordinates.lat,
      lostItem.coordinates.lng,
      foundItem.coordinates.lat,
      foundItem.coordinates.lng,
    );

    if (dist > HANDOVER_CONFIG.LOCATION_RADIUS_KM) {
      return `Location mismatch: items are ${dist.toFixed(2)}km apart (max ${radiusMetres}m allowed)`;
    }
  } else if (!sameLocationText(lostItem.location, foundItem.location)) {
    // Without coordinates the only evidence left is the typed location. Equal
    // text is accepted, anything else is unverifiable and therefore a failure.
    return `Location cannot be verified: one of the items has no coordinates and the reported locations differ`;
  }

  // 2. Date, same calendar day
  const lostDate = toDate(lostItem.date);
  const foundDate = toDate(foundItem.date);

  if (!lostDate || !foundDate) {
    return `Date missing: both items must carry a report date to be handed over`;
  }

  const isSameDay =
    lostDate.getFullYear() === foundDate.getFullYear() &&
    lostDate.getMonth() === foundDate.getMonth() &&
    lostDate.getDate() === foundDate.getDate();

  if (!isSameDay) {
    return `Date mismatch: items reported on different days`;
  }

  // 3. Time window
  const timeDiffHours = calculateTimeDifference(lostDate, foundDate);

  if (timeDiffHours > HANDOVER_CONFIG.TIME_WINDOW_HOURS) {
    return `Time mismatch: items are ${timeDiffHours.toFixed(1)} hours apart (max ${HANDOVER_CONFIG.TIME_WINDOW_HOURS} hours allowed)`;
  }

  return null;
}
