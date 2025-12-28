import {
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  query,
  orderBy,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { getItems } from "./itemService";

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role?: "user" | "admin";
  status?: "active" | "blocked";
  createdAt?: Timestamp;
  lastLoginAt?: Timestamp;
}

const USERS_COLLECTION = "users";

// Get all users (excluding admin email from env)
export async function getUsers(): Promise<User[]> {
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
  const usersRef = collection(db, USERS_COLLECTION);
  
  let q = query(usersRef, orderBy("createdAt", "desc"));
  
  const snapshot = await getDocs(q);
  const users = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: doc.id,
      ...data,
      status: data.status || "active", // Default to active if not set
    } as User;
  });

  // Filter out admin email if specified
  if (adminEmail) {
    return users.filter((user) => user.email !== adminEmail);
  }

  return users;
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
    status: data.status || "active", // Default to active if not set
  } as User;
}

// Update user status (block/unblock)
export async function updateUserStatus(
  uid: string,
  status: "active" | "blocked"
): Promise<void> {
  const docRef = doc(db, USERS_COLLECTION, uid);
  await updateDoc(docRef, {
    status,
  });
}

// Get items count for a user (by userId if exists, or by email)
export async function getUserItemsCount(userEmail: string, userId?: string): Promise<number> {
  try {
    const items = await getItems();
    
    // Try to match by userId first, then by email if userId field exists
    if (userId) {
      const count = items.filter(
        (item) => (item as any).userId === userId || (item as any).userEmail === userEmail
      ).length;
      return count;
    }
    
    // Fallback: match by email if userId field exists in items
    const count = items.filter(
      (item) => (item as any).userEmail === userEmail
    ).length;
    
    return count;
  } catch (error) {
    console.error("Error counting user items:", error);
    return 0;
  }
}
