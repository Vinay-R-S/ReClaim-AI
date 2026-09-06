import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { authGet, authPut } from '../lib/api';
import type { User } from '../types/domain';

const USERS_COLLECTION = 'users';

/** Users per request. The endpoint refuses anything above 100. */
const PAGE_SIZE = 100;

/** A ceiling on how many pages one call will walk. */
const MAX_PAGES = 20;

/**
 * Every non-admin account, newest first.
 *
 * This used to read the whole `users` collection from the browser, which is
 * one of the full-collection client reads PERF-07 is about. It goes through
 * the API a page at a time, and the admin filter is applied server side.
 */
export async function getUsers(): Promise<User[]> {
  const users: User[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: string = cursor
      ? `/api/users?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
      : `/api/users?limit=${PAGE_SIZE}`;

    const data: { users?: User[]; nextCursor?: string | null } = await authGet(query);

    users.push(...(data.users ?? []));

    if (!data.nextCursor) return users;

    cursor = data.nextCursor;
  }

  console.warn(`User list stopped at ${MAX_PAGES} pages; some users were not loaded.`);

  return users;
}

/** One account. Readable by its owner and by an admin. */
export async function getUserById(uid: string): Promise<User | null> {
  const docSnap = await getDoc(doc(db, USERS_COLLECTION, uid));

  if (!docSnap.exists()) return null;

  const data = docSnap.data();

  return {
    ...data,
    uid: docSnap.id,
    status: data.status || 'active',
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
