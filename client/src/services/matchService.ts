import { authGet, authPost, isApiError } from '../lib/api';
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
  claimUserId: string;
  isValid: boolean;
  /** Proceed despite the distance, day and time handover checks failing. */
  overrideCriteria?: boolean;
  overrideReason?: string;
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
    // A refusal on the handover criteria is a decision the admin can override,
    // so which check failed has to reach the modal rather than being flattened
    // into the message.
    if (isApiError(error)) {
      const failure = (error.body as { criteriaFailure?: string } | null)?.criteriaFailure;
      if (failure) {
        (error as ApiErrorWithCriteria).criteriaFailure = failure;
      }
    }

    throw error;
  }
};

type ApiErrorWithCriteria = Error & { criteriaFailure?: string };
