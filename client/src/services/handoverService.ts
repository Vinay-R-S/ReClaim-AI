import { ApiError, apiGet, apiPost, authGet, authPost, withCriteriaFailure } from '../lib/api';
import type {
  HandoverRecord,
  HandoverSession,
  HandoverStatus,
  VerifyCodeResult,
} from '../types/domain';

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

  /** Sessions that have not completed: open, blocked or expired (admin). */
  getSessions: async (): Promise<HandoverSession[]> => {
    const data = await authGet<{ sessions?: HandoverSession[] }>('/api/handover/sessions');

    return data.sessions ?? [];
  },

  /**
   * Issue a fresh code for a session (admin).
   *
   * The only way to reopen one that failed attempts have blocked: the code is
   * hashed, so nobody can look up the old one, and verification refuses a
   * blocked session outright.
   */
  reissue: async (session: {
    matchId: string;
    lostItemId: string;
    foundItemId: string;
    overrideCriteria?: boolean;
    overrideReason?: string;
  }): Promise<{ success: boolean; message: string }> => {
    try {
      return await authPost('/api/handover/reissue', session);
    } catch (error) {
      // A session issued over a criteria override fails those same checks
      // again on re-issue, so the admin has to be able to override once more.
      throw withCriteriaFailure(error);
    }
  },

  /** History of all handovers (admin). */
  getHistory: async (): Promise<HandoverRecord[]> => {
    const data = await authGet<{ history?: HandoverRecord[] }>('/api/handover/history');
    return data.history ?? [];
  },
};
