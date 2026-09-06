/**
 * User administration.
 *
 * `status` is server owned: the Firestore rules deny it to every client, so
 * blocking and unblocking happens here rather than as a direct write from the
 * admin console (defect SEC-17).
 */

import { FieldValue } from 'firebase-admin/firestore';
import { UserRepository, userRepository } from '../repositories/user.repository.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import { createLogger } from '../utils/logger.js';
import type { UserStatus } from '../types/index.js';

const log = createLogger('user.service');

export class UserService {
  constructor(private readonly users: UserRepository = userRepository) {}

  /**
   * A page of the accounts the admin screen manages.
   *
   * Admins are excluded here rather than in the browser: filtering after the
   * page was taken would return short pages and hide the fact that more exist.
   * It used to be a build-time admin email, which went stale the moment a
   * second admin existed (defect SEC-21).
   */
  async listPage(limit: number, cursor?: string) {
    const page = await this.users.listPage(limit, cursor);

    return {
      users: page.users
        .filter((user) => user.role !== 'admin')
        .map((user) => ({
          ...user,
          status: user.status ?? 'active',
          lostItemsCount: user.lostItemsCount ?? 0,
          foundItemsCount: user.foundItemsCount ?? 0,
          totalItemsCount: user.totalItemsCount ?? 0,
        })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Block or unblock an account.
   *
   * An admin cannot change their own status: locking yourself out of the only
   * admin account is not a recoverable mistake from inside the app.
   */
  async setStatus(userId: string, status: UserStatus, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new AppError('You cannot change your own status', 400);
    }

    const user = await this.users.findById(userId);

    if (!user) throw new AppError('User not found', 404);

    await this.users.update(userId, { status, updatedAt: FieldValue.serverTimestamp() });

    log.info('User status changed', { targetUserId: userId, status });
  }
}

export const userService = new UserService();
