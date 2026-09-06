import { authFetch } from '../lib/authApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Status of the handover code document, as the server reports it.
 *
 * These are the only four values `getHandoverStatus` can return. The page used
 * to test for `completed` and `failed`, which the server has never sent, so a
 * finished handover still rendered a live code form (defect UI-06).
 */
export type HandoverCodeStatus = 'pending' | 'verified' | 'blocked' | 'expired';

export interface HandoverStatus {
  status: HandoverCodeStatus;
  attempts: number;
  maxAttempts: number;
  expiresAt: string; // ISO date string
}

export interface VerifyCodeResult {
  success: boolean;
  message: string;
  attemptsLeft?: number;
}

export const handoverService = {
  /**
   * Verify the handover code
   * @param matchId The ID of the match
   * @param code The 6-digit code entered by the user
   */
  verifyCode: async (matchId: string, code: string): Promise<VerifyCodeResult> => {
    const response = await fetch(`${API_URL}/api/handover/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ matchId, code }),
    });

    // A rejected code is a 200 with `success: false`. Every other non-2xx is an
    // error envelope with no `success` at all, so returning it unchecked would
    // report a rate limit, a validation failure or an outage as a wrong code.
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const fallback =
        response.status === 429
          ? 'Too many attempts. Please try again later.'
          : 'Verification is unavailable right now. Please try again.';
      throw new Error(body.error || fallback);
    }

    return response.json();
  },

  /**
   * Get the status of a handover session
   * @param matchId The ID of the match
   */
  getStatus: async (matchId: string): Promise<HandoverStatus | null> => {
    const response = await fetch(`${API_URL}/api/handover/status/${matchId}`);

    // No session for this match. The caller shows "link invalid or expired",
    // which is a different thing from the server being unreachable.
    if (response.status === 404) return null;

    if (!response.ok) {
      throw new Error('Failed to get handover status');
    }

    return response.json();
  },

  /**
   * Get history of all handovers (Admin)
   */
  getHistory: async () => {
    const response = await authFetch('/api/handover/history');
    if (!response.ok) {
      throw new Error('Failed to get handover history');
    }
    const data = await response.json();
    return data.history;
  },
};
