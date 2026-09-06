import { authGet, authPut } from '../lib/api';
import type { CreditBalance, CreditTransaction } from '../types/domain';

/**
 * The credit ledger.
 *
 * The balance itself is read by `useCredits`, which shares one copy of it
 * across every screen that shows the badge.
 */
export const creditService = {
  /** The entries behind a balance, newest first. Own account, or admin. */
  getHistory: async (userId: string): Promise<CreditTransaction[]> => {
    const data = await authGet<{ history?: CreditTransaction[] }>(`/api/credits/history/${userId}`);

    return data.history ?? [];
  },

  /** Move a balance by a delta (admin). Negative takes credits away. */
  adjust: (userId: string, amount: number, reason?: string): Promise<CreditBalance> =>
    authPut(`/api/credits/${userId}`, { amount, reason }),
};
