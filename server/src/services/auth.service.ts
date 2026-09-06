/**
 * Sign-in side effects: the profile document and the login notice.
 *
 * The browser used to write `users/{uid}` itself, including `role`, `status`
 * and `credits`, which meant anyone could self-assign `role: "admin"` or an
 * arbitrary balance (defect SEC-17). Those fields are decided here.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { UserRepository, userRepository } from '../repositories/user.repository.js';
import { awardSignupBonus } from './credits.service.js';
import { sendLoginNotification } from './email.service.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import { stripUndefined } from '../utils/firestore.js';
import { createLogger } from '../utils/logger.js';
import type { UserProfile } from '../types/index.js';

const log = createLogger('auth.service');

export interface ProfileResult {
  created: boolean;
  profile: UserProfile;
}

export interface ProfileInput {
  displayName?: string;
  photoURL?: string;
}

export class AuthService {
  constructor(private readonly users: UserRepository = userRepository) {}

  /**
   * Create the caller's profile on first sign-in, or refresh `lastLoginAt`.
   *
   * Sign-in fires this from two places at once (the auth state listener and the
   * sign-in call itself), so a read-then-write would let both take the create
   * branch and both reset `createdAt` and the balance. The create is atomic:
   * the loser falls through to the update path.
   */
  async bootstrapProfile(
    uid: string,
    email: string | undefined,
    input: ProfileInput,
  ): Promise<ProfileResult> {
    // The balance starts at zero. The welcome bonus is awarded by the credits
    // service straight after, so it lands in the ledger like every other credit
    // movement instead of being a literal written here (defect LOG-01b).
    const profile: UserProfile = {
      uid,
      email: email ?? null,
      displayName: input.displayName ?? null,
      photoURL: input.photoURL ?? null,
      role: 'user',
      status: 'active',
      credits: 0,
    };

    const created = await this.users.createIfAbsent(uid, {
      ...profile,
      lostItemsCount: 0,
      foundItemsCount: 0,
      totalItemsCount: 0,
    });

    if (created) {
      log.info('User profile created', { userId: uid });

      const bonus = await awardSignupBonus(uid);

      return {
        created: true,
        profile: { ...profile, credits: bonus.success ? bonus.newBalance : profile.credits },
      };
    }

    return this.refreshProfile(uid, email, input);
  }

  private async refreshProfile(
    uid: string,
    email: string | undefined,
    input: ProfileInput,
  ): Promise<ProfileResult> {
    const existing = await this.users.findById(uid);

    // The create said the document exists and the read says it does not, which
    // only happens if it was deleted in between.
    if (!existing) throw new AppError('User not found', 404);

    if (existing.status === 'blocked') {
      throw new AppError('Account blocked', 403, {
        message: 'Your account has been blocked due to policy violations.',
      });
    }

    // Self-heal a profile whose creation succeeded while the award did not.
    //
    // The zero-balance condition is what makes this safe to deploy before the
    // backfill has run. Every profile created before the credits rework carries
    // a literal `credits: 10` with no ledger entry, so an idempotency check
    // alone would pay all of them a second time on their next sign-in. Only a
    // profile still sitting at zero can be missing its bonus.
    const needsBonus = existing.signupBonusAwarded !== true && (existing.credits ?? 0) === 0;
    const bonus = needsBonus ? await awardSignupBonus(uid) : null;

    // Email/password signup sets the display name a moment after the account
    // exists, so the first call can arrive without one. Fill it in rather than
    // leaving the profile permanently nameless.
    const displayName = existing.displayName || input.displayName || null;

    await this.users.update(
      uid,
      stripUndefined({
        lastLoginAt: FieldValue.serverTimestamp(),
        displayName: existing.displayName ? undefined : (input.displayName ?? undefined),
      }),
    );

    return {
      created: false,
      profile: {
        uid,
        email: existing.email ?? email ?? null,
        displayName,
        photoURL: existing.photoURL ?? null,
        role: existing.role === 'admin' ? 'admin' : 'user',
        status: existing.status ?? 'active',
        credits: bonus?.success ? bonus.newBalance : (existing.credits ?? 0),
      },
    };
  }

  /**
   * Tell the account holder that someone signed in.
   *
   * The uid comes from the verified token, so this endpoint cannot be used as a
   * user-existence probe or an email spam trigger (defect SEC-14).
   */
  async notifyLogin(userId: string, loginTime: string | undefined): Promise<string> {
    log.debug('Login notification requested', { userId });

    const user = await this.users.findById(userId);

    if (!user) {
      log.warn('Login notification for unknown user', { userId });
      throw new AppError('User not found in Firestore', 404);
    }

    if (!user.email) {
      throw new AppError('User email not found', 400);
    }

    const name = user.displayName || user.email.split('@')[0] || 'User';
    const sent = await sendLoginNotification(
      user.email,
      name,
      loginTime || new Date().toLocaleString(),
    );

    if (!sent) {
      log.warn('Login notification not sent, email transport unavailable', { userId });
      throw new AppError('Failed to send login notification email', 500);
    }

    log.info('Login notification sent', { userId });

    return user.email;
  }
}

export const authService = new AuthService();
