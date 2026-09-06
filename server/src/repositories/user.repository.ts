/**
 * User persistence.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import type { User, UserRole } from '../types/index.js';

export type StoredUser = Partial<User> & { uid: string };

export class UserRepository {
  constructor(private readonly users = collections.users) {}

  async findById(uid: string): Promise<StoredUser | null> {
    const doc = await this.users.doc(uid).get();

    if (!doc.exists) return null;

    return { ...(doc.data() as User), uid: doc.id };
  }

  /**
   * Create the document, or report that one is already there.
   *
   * `create()` is atomic, which is what makes two concurrent sign-ins safe:
   * the loser gets ALREADY_EXISTS rather than resetting `createdAt` and the
   * balance of the winner.
   */
  async createIfAbsent(uid: string, data: Record<string, unknown>): Promise<boolean> {
    try {
      await this.users.doc(uid).create({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
      });

      return true;
    } catch (error) {
      // ALREADY_EXISTS. Anything else is a real failure and must surface.
      if ((error as { code?: number }).code === 6) return false;

      throw error;
    }
  }

  async update(uid: string, data: Record<string, unknown>): Promise<void> {
    await this.users.doc(uid).update(data);
  }

  async merge(uid: string, data: Record<string, unknown>): Promise<void> {
    await this.users.doc(uid).set(data, { merge: true });
  }

  /**
   * A page of users, newest first.
   *
   * The admin screen used to read the whole collection from the browser
   * (defect PERF-07). A cursor rather than an offset, for the same reason the
   * item list uses one: Firestore has no offset that does not read what it
   * skips.
   */
  async listPage(
    limit: number,
    cursor?: string,
  ): Promise<{ users: StoredUser[]; nextCursor: string | null }> {
    let query = this.users.orderBy('createdAt', 'desc').limit(limit);

    if (cursor) {
      const anchor = await this.users.doc(cursor).get();

      // A deleted anchor ends the walk rather than silently restarting it.
      if (!anchor.exists) return { users: [], nextCursor: null };

      query = query.startAfter(anchor);
    }

    const snapshot = await query.get();
    const users = snapshot.docs.map((doc) => ({ ...(doc.data() as User), uid: doc.id }));

    return {
      users,
      nextCursor: users.length === limit ? (users[users.length - 1]?.uid ?? null) : null,
    };
  }

  async listByRole(role: UserRole, limit: number): Promise<StoredUser[]> {
    const snapshot = await this.users.where('role', '==', role).limit(limit).get();

    return snapshot.docs.map((doc) => ({ ...(doc.data() as User), uid: doc.id }));
  }

  /** Admin addresses for the notices that go to whoever is on duty. */
  async listAdminEmails(limit: number): Promise<string[]> {
    const admins = await this.listByRole('admin', limit);

    return admins
      .map((admin) => admin.email)
      .filter((email): email is string => typeof email === 'string' && email.length > 0);
  }
}

export const userRepository = new UserRepository();
