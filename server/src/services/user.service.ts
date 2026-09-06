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
