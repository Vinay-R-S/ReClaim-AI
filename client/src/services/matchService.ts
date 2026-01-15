import { Timestamp } from "firebase/firestore";

export interface Match {
    id: string;
    lostItemId: string;
    foundItemId: string;
    matchScore: number;
    tagScore: number;
    colorScore: number;
    imageScore: number;
    status: "matched" | "claimed";
    isActive?: boolean;
    createdAt: Timestamp;
    claimedAt?: Timestamp;
}

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Get only active matches (not yet claimed)
 */
export const getAllMatches = async (): Promise<Match[]> => {
    try {
        const response = await fetch(`${API_URL}/api/matches`);
        if (!response.ok) {
            throw new Error(`Failed to fetch matches: ${response.statusText}`);
        }
        const data = await response.json();
        return data.matches;
    } catch (error) {
        console.error("Error fetching matches:", error);
        throw error;
    }
};

/**
 * Get all matches including historical (claimed) matches
 * Used for dashboard graphs that need to persist data after claims
 */
export const getAllMatchesWithHistory = async (): Promise<Match[]> => {
    try {
        const response = await fetch(`${API_URL}/api/matches/all`);
        if (!response.ok) {
            throw new Error(`Failed to fetch all matches: ${response.statusText}`);
        }
        const data = await response.json();
        return data.matches;
    } catch (error) {
        console.error("Error fetching all matches with history:", error);
        throw error;
    }
};
