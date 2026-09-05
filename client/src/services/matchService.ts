import { Timestamp } from 'firebase/firestore';
import { authFetch } from '../lib/authApi';

export interface Match {
  id: string;
  lostItemId: string;
  foundItemId: string;
  matchScore: number;
  /** Written as the semantic score; the name is kept for the older screens. */
  tagScore: number;
  colorScore: number;
  imageScore: number;
  semanticScore?: number;
  locationScore?: number;
  timeScore?: number;
  status: 'matched' | 'claimed' | 'rejected';
  isActive?: boolean;
  createdAt: Timestamp;
  claimedAt?: Timestamp;
}

/**
 * Get only active matches (not yet claimed)
 */
export const getAllMatches = async (): Promise<Match[]> => {
  try {
    const response = await authFetch('/api/matches');
    if (!response.ok) {
      throw new Error(`Failed to fetch matches: ${response.statusText}`);
    }
    const data = await response.json();
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
    const response = await authFetch('/api/matches/all');
    if (!response.ok) {
      throw new Error(`Failed to fetch all matches: ${response.statusText}`);
    }
    const data = await response.json();
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
  const response = await authFetch('/api/matches/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || 'Failed to verify the match') as Error & {
      criteriaFailure?: string;
    };
    error.criteriaFailure = data.criteriaFailure;
    throw error;
  }

  return data;
};
