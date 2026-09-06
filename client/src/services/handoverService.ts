import { ApiError, apiGet, apiPost, authGet } from '../lib/api';
import type { HandoverRecord, HandoverStatus, VerifyCodeResult } from '../types/domain';

export const handoverService = {
  /**
   * Verify the handover code.
   *
   * Public by design: the finder holds a link and a code, not an account. A
   * rejected code is a 200 with `success: false`; anything else throws, so a
   * rate limit or an outage is not reported to them as a wrong code.
   */
  verifyCode: (matchId: string, code: string): Promise<VerifyCodeResult> =>
    apiPost<VerifyCodeResult>('/api/handover/verify', { matchId, code }),

  /**
   * Get the status of a handover session, or null when there is no session
   * behind this link. A 404 is a dead link; anything else is a real failure
   * and the caller must be able to tell them apart.
   */
  getStatus: async (matchId: string): Promise<HandoverStatus | null> => {
    try {
      return await apiGet<HandoverStatus>(`/api/handover/status/${matchId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },

  /** History of all handovers (admin). */
  getHistory: async (): Promise<HandoverRecord[]> => {
    const data = await authGet<{ history?: HandoverRecord[] }>('/api/handover/history');
    return data.history ?? [];
  },
};
