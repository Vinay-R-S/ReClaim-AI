// AI Service for Image Analysis
// Supports both Google Gemini and Groq APIs

export type AIProvider = "gemini" | "groq";

export interface AnalysisResult {
    name: string;
    description: string;
    tags: string[];
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// Switching to stable v1 endpoint to avoid 404s and use standard gemini-1.5-flash
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

const ANALYSIS_PROMPT = `Analyze this image of a lost/found item and provide:
1. A proper, descriptive name for the item (e.g., "Black Dell Laptop Bag" instead of just "bag")
2. A detailed description (2-3 sentences about the item's appearance)
3. Tags/attributes as an array (color, brand, size, material, condition, any distinctive features)

Respond ONLY with valid JSON in this exact format:
{
  "name": "Item Name",
  "description": "Detailed description here.",
  "tags": ["tag1", "tag2", "tag3"]
}`;

// Convert File to base64
export async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data:image/...;base64, prefix
            const base64 = result.split(",")[1];
            resolve(base64);
        };
        reader.onerror = (error) => reject(error);
    });
}

// Analyze image with Groq API
async function analyzeWithGroq(imageBase64: string, mimeType: string): Promise<AnalysisResult> {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY;

    if (!apiKey) {
        throw new Error("Groq API key not configured");
    }

    const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "meta-llama/llama-4-scout-17b-16e-instruct",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: ANALYSIS_PROMPT,
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${mimeType};base64,${imageBase64}`,
                            },
                        },
                    ],
                },
            ],
            temperature: 0.3,
            max_tokens: 1024,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Groq API error: ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    return parseAnalysisResponse(content);
}

// Analyze image with Gemini API
async function analyzeWithGemini(imageBase64: string, mimeType: string): Promise<AnalysisResult> {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error("Gemini API key not configured");
    }

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        { text: ANALYSIS_PROMPT },
                        {
                            inline_data: {
                                mime_type: mimeType,
                                data: imageBase64,
                            },
                        },
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024,
            },
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    return parseAnalysisResponse(content);
}

// Parse JSON response from LLM
function parseAnalysisResponse(content: string): AnalysisResult {
    try {
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = content;
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }

        const parsed = JSON.parse(jsonStr.trim());

        return {
            name: parsed.name || "Unknown Item",
            description: parsed.description || "No description available",
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        };
    } catch (err) {
        console.error("Failed to parse AI response:", err, content);
        return {
            name: "Unknown Item",
            description: "AI analysis failed. Please add details manually.",
            tags: [],
        };
    }
}

// Main analysis function
export async function analyzeItemImage(
    file: File,
    provider: AIProvider = "gemini"
): Promise<AnalysisResult> {
    const base64 = await fileToBase64(file);
    const mimeType = file.type || "image/jpeg";

    if (provider === "groq") {
        return analyzeWithGroq(base64, mimeType);
    } else {
        return analyzeWithGemini(base64, mimeType);
    }
}

// Check which providers are available
export function getAvailableProviders(): AIProvider[] {
    const providers: AIProvider[] = [];

    if (import.meta.env.VITE_GEMINI_API_KEY) {
        providers.push("gemini");
    }
    if (import.meta.env.VITE_GROQ_API_KEY) {
        providers.push("groq");
    }

    return providers;
}

// Enhance text description and generate tags (for Lost items without image)
export async function enhanceTextDescription(
    name: string,
    description: string,
    provider: AIProvider = "groq"
): Promise<AnalysisResult> {
    const prompt = `You are helping a lost and found system. A user has reported a lost item with the following details:

Name: ${name}
Description: ${description}

Please:
1. Enhance the item name to be more descriptive if needed
2. Improve the description with more detail based on the information given
3. Generate relevant tags/keywords for better matching

Respond ONLY with valid JSON in this exact format:
{
  "name": "Enhanced Item Name",
  "description": "Enhanced detailed description here.",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`;

    const apiKey = provider === "groq"
        ? import.meta.env.VITE_GROQ_API_KEY
        : import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        // Return original if no API key
        return { name, description, tags: [] };
    }

    try {
        let content: string;

        if (provider === "groq") {
            const response = await fetch(GROQ_API_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.3,
                    max_tokens: 512,
                }),
            });

            if (!response.ok) {
                throw new Error(`Groq API error`);
            }

            const data = await response.json();
            content = data.choices[0]?.message?.content || "";
        } else {
            const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
                }),
            });

            if (!response.ok) {
                throw new Error(`Gemini API error`);
            }

            const data = await response.json();
            content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }

        return parseAnalysisResponse(content);
    } catch (err) {
        console.error("Text enhancement failed:", err);
        // Return original values on error
        return { name, description, tags: [] };
    }
}
