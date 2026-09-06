import { collection, doc, getDocs, getDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authDelete, authGet, authPost, authPut } from '../lib/api';
import { compressImage } from '../lib/imageCompression';
import type { AdminAuditEntry, Item, ItemInput, ModerationStatus } from '../types/domain';

/**
 * Longest edge for an image stored inline on the item document, which must
 * stay under the 1 MB Firestore document limit.
 */
const IMAGE_MAX_EDGE = 800;

const ITEMS_COLLECTION = 'items';

// Get all items
export async function getItems(): Promise<Item[]> {
  const itemsRef = collection(db, ITEMS_COLLECTION);
  const q = query(itemsRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Item[];
}

// Get single item by ID
export async function getItemById(id: string): Promise<Item | null> {
  const docRef = doc(db, ITEMS_COLLECTION, id);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return {
    id: docSnap.id,
    ...docSnap.data(),
  } as Item;
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
