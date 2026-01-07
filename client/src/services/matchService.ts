import { Timestamp } from "firebase/firestore";

export interface Match {
    id: string;
    lostItemId: string;
    foundItemId: string;
    matchScore: number;
    tagScore: number;
    colorScore: number;
    imageScore: number;
    status: "matched";
    createdAt: Timestamp;
}

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

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
