import fetch from 'node-fetch';

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent";

/**
 * Generate a text embedding using Google Gemini API
 * @param text The text to generate an embedding for
 * @returns 768-dimensional vector (array of numbers)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error('[EMBEDDING] Gemini API key not found in environment variables');
        return [];
    }

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: {
                    parts: [{ text }]
                }
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Gemini Embedding API error: ${error}`);
        }

        const data = await response.json() as any;
        return data.embedding.values;
    } catch (err) {
        console.error('[EMBEDDING] Failed to generate embedding:', err);
        return [];
    }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    const similarity = dotProduct / (normA * normB);

    // Scale similarity from [-1, 1] to [0, 1] if needed, 
    // though cosine for embeddings is usually positive in this context.
    // We normalize slightly to ensure it fits the 0-1 range cleanly.
    return Math.max(0, Math.min(1, similarity));
}

/**
 * Combine item fields into a meaningful string for embedding
 */
export function createItemEmbeddingString(itemData: {
    name: string,
    description: string,
    tags?: string[],
    color?: string
}): string {
    const tagsStr = (itemData.tags || []).join(', ');
    return `Item: ${itemData.name}. Description: ${itemData.description}. Tags: ${tagsStr}. Color: ${itemData.color || 'none'}.`.toLowerCase();
}
