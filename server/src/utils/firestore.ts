/**
 * Firestore write helpers
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
