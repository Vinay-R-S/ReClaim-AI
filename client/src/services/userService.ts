import { collection, doc, getDocs, getDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authPut } from '../lib/api';
import type { User } from '../types/domain';

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

/**
 * How many items a user has reported.
 *
 * Reads the running total the server keeps on the user document. This used to
 * pull the whole item collection and filter it on `userId` and `userEmail`,
 * neither of which an item carries: items are stored with `reportedBy` and
 * `reportedByEmail`, so the count was always 0 (defect UI-08).
 */
export async function getUserItemsCount(uid: string): Promise<number> {
  try {
    const user = await getUserById(uid);
    return user?.totalItemsCount ?? 0;
  } catch (error) {
    console.error('Error counting user items:', error);
    return 0;
  }
}
