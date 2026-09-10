/**
 * Firestore read and write helpers
 */

/**
 * Drop keys whose value is undefined.
 *
 * Firestore rejects undefined values, so a handler that builds an update object
 * from optional request fields throws at write time unless the holes are
 * removed first. Removal is always explicit through FieldValue.delete().
 */
export function stripUndefined<T extends Record<string, unknown>>(data: T): Partial<T> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  return cleaned as Partial<T>;
}

/**
 * Read whatever a date field holds.
 *
 * A report date arrives as a Firestore `Timestamp` from a document, a `Date`
 * from a service call, or a string from a request that has been through JSON.
 * A missing or unreadable value returns null and must fail whatever check
 * wanted it, never read as "now".
 *
 * It lives here rather than beside any one caller because three of them wanted
 * it: the matching pipeline, the handover criteria, and the adjudication
 * tools. The last of those is what forced the move — importing it from the
 * pipeline made the pipeline and the agent import each other, and a cycle in
 * ESM leaves whichever module loses the race holding undefined exports.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (value && typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number };

    if (typeof candidate.toDate === 'function') {
      const converted = candidate.toDate();

      return Number.isNaN(converted.getTime()) ? null : converted;
    }

    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000);
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}
