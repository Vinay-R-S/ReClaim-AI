import { ApiError, authDelete, authGet, authPost, authPut } from '../lib/api';
import { compressImage } from '../lib/imageCompression';
import type { AdminAuditEntry, Item, ItemInput, ModerationStatus } from '../types/domain';

/**
 * Longest edge for an image stored inline on the item document, which must
 * stay under the 1 MB Firestore document limit.
 */
const IMAGE_MAX_EDGE = 800;

/** Items per request. The endpoint refuses anything above 100. */
const PAGE_SIZE = 100;

/**
 * A ceiling on how many pages one call will walk.
 *
 * The admin screens want the whole list, and the honest way to give it to them
 * is to page through it rather than to ask Firestore for every document at
 * once from the browser. The cap is what stops a growing project turning a
 * screen load into an unbounded sequence of requests; PERF-01 is what removes
 * the need for the walk at all, by filtering server side per screen.
 */
const MAX_PAGES = 20;

/**
 * Every item the caller may see, newest first.
 *
 * This used to read the `items` collection directly from the browser, which
 * needed a rule that let an admin read every document and pulled the whole
 * corpus over the wire (defect PERF-07). It goes through the API now, a page
 * at a time.
 */
export async function getItems(): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: string = cursor
      ? `/api/items?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
      : `/api/items?limit=${PAGE_SIZE}`;

    const data: { items?: Item[]; nextCursor?: string | null } = await authGet(query);

    items.push(...(data.items ?? []));

    if (!data.nextCursor) return items;

    cursor = data.nextCursor;
  }

  console.warn(`Item list stopped at ${MAX_PAGES} pages; some items were not loaded.`);

  return items;
}

export async function getItemById(id: string): Promise<Item | null> {
  try {
    const { item } = await authGet<{ item?: Item }>(`/api/items/${id}`);

    return item ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;

    throw error;
  }
}

// Update item via server API (requires authentication)
export async function updateItemViaApi(
  id: string,
  updates: Partial<ItemInput>,
  newImages?: string[], // Base64 images
): Promise<void> {
  await authPut(`/api/items/${id}`, { updates, images: newImages });
}

// Delete item via server API (requires authentication)
export async function deleteItemViaApi(id: string): Promise<void> {
  await authDelete(`/api/items/${id}`);
}

// Store image as Base64 in Firestore (Bypassing Storage Bucket)
export async function uploadItemImage(file: File): Promise<string> {
  let dataUrl: string;

  try {
    ({ dataUrl } = await compressImage(file, IMAGE_MAX_EDGE));
  } catch (error) {
    console.error('Error processing image:', error);
    // Compression already says what is wrong with this particular file, and
    // replacing that with a generic message left the caller nothing to act on.
    throw error instanceof Error ? error : new Error('Failed to process the image');
  }

  if (dataUrl.length > 900000) {
    // Safety check for the 1MB document limit
    throw new Error('Image too large even after compression. Please use a smaller image.');
  }

  return dataUrl;
}

/**
 * Approve or reject a reported item (admin).
 *
 * Approval is what makes the item publicly visible and starts its matching
 * run, so this is not the same thing as setting a status.
 */
export async function moderateItem(
  id: string,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<{ moderation: ModerationStatus; matching: string }> {
  return authPost(`/api/items/${id}/moderate`, { decision, reason });
}

/** Review decisions taken on an item, newest first (admin). */
export async function getItemAudit(id: string): Promise<AdminAuditEntry[]> {
  const data = await authGet<{ entries?: AdminAuditEntry[] }>(`/api/items/${id}/audit`);

  return data.entries ?? [];
}
