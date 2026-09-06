/**
 * The credit balance as the API presents it.
 *
 * `credits.service.ts` owns how a balance moves; this owns who may ask about
 * it and what a caller is told when the account is not there.
 */

import { adjustCredits, getCreditHistory } from './credits.service.js';
import { UserRepository, userRepository } from '../repositories/user.repository.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import type { CreditBalance, CreditTransaction } from '../types/index.js';

export class CreditAccountService {
  constructor(private readonly users: UserRepository = userRepository) {}

  async getBalance(userId: string): Promise<CreditBalance> {
    const user = await this.users.findById(userId);

    if (!user) throw new AppError('User not found', 404);

    return { userId, email: user.email || '', credits: user.credits ?? 0 };
  }

  /**
   * Move a balance by a delta.
   *
   * The account is checked first so that a typo'd uid is a 404 rather than a
   * ledger entry against a user that does not exist.
   */
  async adjust(
    userId: string,
    amount: number,
    reason: string | undefined,
  ): Promise<CreditBalance & { added: number }> {
    const user = await this.users.findById(userId);

    if (!user) throw new AppError('User not found', 404);

    const result = await adjustCredits(userId, amount, reason);

    if (!result.success) {
      throw new AppError('Failed to adjust credits', 500);
    }

    return {
      userId,
      email: user.email || '',
      credits: result.newBalance,
      added: amount,
    };
  }

  history(userId: string, limit: number): Promise<CreditTransaction[]> {
    return getCreditHistory(userId, limit);
  }
}

export const creditAccountService = new CreditAccountService();
