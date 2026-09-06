import { collection, doc, getDocs, getDoc, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authFetch } from '../lib/authApi';
import { compressImage } from '../lib/imageCompression';

/**
 * Longest edge for an image stored inline on the item document, which must
 * stay under the 1 MB Firestore document limit.
 */
const IMAGE_MAX_EDGE = 800;

/** Admin review state, independent of the match status. */
export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export type AdminAuditAction =
  'item_approved' | 'item_rejected' | 'match_verified' | 'match_rejected';

export interface AdminAuditEntry {
  id: string;
  action: AdminAuditAction;
  targetId: string;
  actorId: string;
  reason?: string;
  details?: Record<string, unknown>;
  createdAt?: { _seconds?: number; seconds?: number };
}

// Item type definition
export interface Item {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  cloudinaryUrls?: string[]; // Images from chat flow
  type: 'Lost' | 'Found';
  location: string;
  coordinates?: { lat: number; lng: number };
  date: Timestamp | Date;
  status: 'Pending' | 'Matched' | 'Claimed';
  /** Absent on items reported before review existed, which read as approved. */
  moderation?: ModerationStatus;
  moderatedBy?: string;
  moderatedAt?: Timestamp;
  moderationReason?: string;
  matchScore?: number;
  /** Best score seen while matching when nothing crossed the threshold. */
  bestCandidateScore?: number;
  tags?: string[];
  color?: string;
  category?: string;
  images?: string[];
  contactEmail?: string; // Email for contact
  reportedBy?: string; // User ID who reported
  reportedByEmail?: string; // For notifications
  matchedItemId?: string; // ID of matched item
  matchedUserId?: string; // User who claimed
  /** Set by POST /api/matches/claim on the found item. */
  claimedBy?: string;
  verificationRequired?: boolean;
  verificationConfidence?: number;
  verifiedBy?: string;
  verifiedAt?: Timestamp;
  collectionPoint?: string;
  collectionInstructions?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Input type for creating/updating items (without id and timestamps)
export interface ItemInput {
  name: string;
  description: string;
  imageUrl?: string;
  type: 'Lost' | 'Found';
  location: string;
  coordinates?: { lat: number; lng: number };
  date: Date;
  status: 'Pending' | 'Matched' | 'Claimed';
  matchScore?: number;
  tags?: string[];
  color?: string;
  category?: string;
  images?: string[]; // Array of base64 strings for multiple images
}

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
  const response = await authFetch(`/api/items/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      updates,
      images: newImages,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update item');
  }
}

// Delete item via server API (requires authentication)
export async function deleteItemViaApi(id: string): Promise<void> {
  const response = await authFetch(`/api/items/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete item');
  }
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
  const response = await authFetch(`/api/items/${id}/moderate`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Failed to record the decision');
  }

  return data;
}

/** Review decisions taken on an item, newest first (admin). */
export async function getItemAudit(id: string): Promise<AdminAuditEntry[]> {
  const response = await authFetch(`/api/items/${id}/audit`);

  if (!response.ok) {
    throw new Error('Failed to load the review history');
  }

  const data = await response.json();

  return data.entries ?? [];
}
