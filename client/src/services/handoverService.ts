const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export interface HandoverStatus {
    id: string;
    matchId: string;
    lostItemId: string;
    foundItemId: string;
    status: "pending" | "completed" | "failed" | "expired" | "blocked";
    attempts: number;
    maxAttempts: number;
    expiresAt: string; // ISO date string
}

export const handoverService = {
    /**
     * Verify the handover code
     * @param matchId The ID of the match
     * @param code The 6-digit code entered by the user
     */
    verifyCode: async (matchId: string, code: string) => {
        const response = await fetch(`${API_URL}/api/handover/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ matchId, code }),
        });
        return response.json();
    },

    /**
     * Get the status of a handover session
     * @param matchId The ID of the match
     */
    getStatus: async (matchId: string): Promise<HandoverStatus> => {
        const response = await fetch(`${API_URL}/api/handover/status/${matchId}`);
        if (!response.ok) {
            throw new Error("Failed to get handover status");
        }
        return response.json();
    },

    /**
     * Get history of all handovers (Admin)
     */
    getHistory: async () => {
        const response = await fetch(`${API_URL}/api/handover/history`);
        if (!response.ok) {
            throw new Error("Failed to get handover history");
        }
        const data = await response.json();
        return data.history;
    },
};
