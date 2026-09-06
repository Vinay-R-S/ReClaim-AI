import { authGet, authPost, withCriteriaFailure } from '../lib/api';
import type { Match } from '../types/domain';

/**
 * Get only active matches (not yet claimed)
 */
export const getAllMatches = async (): Promise<Match[]> => {
  try {
    const data = await authGet<{ matches: Match[] }>('/api/matches');
    return data.matches;
  } catch (error) {
    console.error('Error fetching matches:', error);
    throw error;
  }
};

/**
 * Get all matches including historical (claimed) matches
 * Used for dashboard graphs that need to persist data after claims
 */
export const getAllMatchesWithHistory = async (): Promise<Match[]> => {
  try {
    const data = await authGet<{ matches: Match[] }>('/api/matches/all');
    return data.matches;
  } catch (error) {
    console.error('Error fetching all matches with history:', error);
    throw error;
  }
};

export interface VerifyMatchInput {
  itemId: string;
  /** The match record being decided on, so a runner-up pair resolves too. */
  matchId?: string;
  /** Only needed to name who a false-claim penalty is for. */
  claimUserId?: string;
  isValid: boolean;
  /** Proceed despite the distance, day and time handover checks failing. */
  overrideCriteria?: boolean;
  overrideReason?: string;
  /** Charge the false-claim penalty on a rejection. The admin's own decision. */
  penaliseClaimant?: boolean;
}

export interface VerifyMatchResult {
  success: boolean;
  message: string;
  criteriaFailure?: string;
}

/**
 * Admin decision on a match: verify it and start the handover, or reject the
 * claim and penalise the claimant.
 */
export const verifyMatch = async (input: VerifyMatchInput): Promise<VerifyMatchResult> => {
  try {
    return await authPost<VerifyMatchResult>('/api/matches/verify', input);
  } catch (error) {
    throw withCriteriaFailure(error);
  }
};
