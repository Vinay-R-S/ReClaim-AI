import { collection, doc, getDocs, getDoc, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authPut } from '../lib/authApi';
import { getItems } from './itemService';

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role?: 'user' | 'admin';
  status?: 'active' | 'blocked';
  createdAt?: Timestamp;
  lastLoginAt?: Timestamp;
  // Item submission counts
  lostItemsCount?: number;
  foundItemsCount?: number;
  totalItemsCount?: number;
}

const USERS_COLLECTION = 'users';

// Get all users (admins are managed elsewhere and excluded from this list)
export async function getUsers(): Promise<User[]> {
  const usersRef = collection(db, USERS_COLLECTION);

  const q = query(usersRef, orderBy('createdAt', 'desc'));

  const snapshot = await getDocs(q);
  const users = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: doc.id,
      ...data,
      status: data.status || 'active', // Default to active if not set
      lostItemsCount: data.lostItemsCount || 0,
      foundItemsCount: data.foundItemsCount || 0,
      totalItemsCount: data.totalItemsCount || 0,
    } as User;
  });

  // Filter by role rather than by a build-time admin email: the email was
  // compiled into the bundle and went stale the moment a second admin existed
  // (defect SEC-21).
  return users.filter((user) => user.role !== 'admin');
}

// Get single user by ID
export async function getUserById(uid: string): Promise<User | null> {
  const docRef = doc(db, USERS_COLLECTION, uid);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  const data = docSnap.data();
  return {
    uid: docSnap.id,
    ...data,
    status: data.status || 'active', // Default to active if not set
    lostItemsCount: data.lostItemsCount || 0,
    foundItemsCount: data.foundItemsCount || 0,
    totalItemsCount: data.totalItemsCount || 0,
  } as User;
}

// Update user status (block/unblock)
//
// `status` is server owned and denied to the browser by the Firestore rules,
// so this goes through the API where the admin role is actually checked.
export async function updateUserStatus(uid: string, status: 'active' | 'blocked'): Promise<void> {
  await authPut(`/api/users/${uid}/status`, { status });
}

// Get items count for a user (by userId if exists, or by email)
export async function getUserItemsCount(userEmail: string, userId?: string): Promise<number> {
  try {
    const items = await getItems();

    // Try to match by userId first, then by email if userId field exists
    if (userId) {
      const count = items.filter(
        (item) => (item as any).userId === userId || (item as any).userEmail === userEmail,
      ).length;
      return count;
    }

    // Fallback: match by email if userId field exists in items
    const count = items.filter((item) => (item as any).userEmail === userEmail).length;

    return count;
  } catch (error) {
    console.error('Error counting user items:', error);
    return 0;
  }
}
