// AI Service for Image Analysis
// Supports both Google Gemini and Groq APIs

export type AIProvider = "gemini" | "groq";

export interface AnalysisResult {
    name: string;
    description: string;
    tags: string[];
    color: string;
    category: string;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// Switching to stable v1 endpoint to avoid 404s and use standard gemini-1.5-flash
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";

const ANALYSIS_PROMPT = `Analyze this image (or these images) of a lost/found item and provide:
1. A proper, descriptive name for the item
2. A detailed description (2-3 sentences) - if multiple images, synthesize details from all of them
3. Tags/attributes as an array - include features visible across all images
4. The primary color of the item (a single word like "Black", "Silver", "Red")
5. The most appropriate category (e.g., "Electronics", "Personal Accessories", "Documents", "Clothing", "Bags", "Keys", "Pets", "Other")

If multiple images are provided, analyze ALL of them together to create a comprehensive description.

Respond ONLY with valid JSON in this exact format:
{
  "name": "Item Name",
  "description": "Detailed description here.",
  "tags": ["tag1", "tag2"],
  "color": "ColorName",
  "category": "CategoryName"
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
            color: parsed.color || "",
            category: parsed.category || "Other",
        };
    } catch (err) {
        console.error("Failed to parse AI response:", err, content);
        return {
            name: "Unknown Item",
            description: "AI analysis failed. Please add details manually.",
            tags: [],
            color: "",
            category: "Other",
        };
    }
}

// Main analysis function (single image - kept for backward compatibility)
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

// Analyze multiple images together
export async function analyzeMultipleImages(
    files: File[],
    provider: AIProvider = "groq"
): Promise<AnalysisResult> {
    if (files.length === 0) {
        return {
            name: "Unknown Item",
            description: "No images provided for analysis.",
            tags: [],
            color: "",
            category: "Other",
        };
    }

    // If only one file, use the single image function
    if (files.length === 1) {
        return analyzeItemImage(files[0], provider);
    }

    // Convert all files to base64
    const imagesData = await Promise.all(
        files.map(async (file) => ({
            base64: await fileToBase64(file),
            mimeType: file.type || "image/jpeg",
        }))
    );

    // Use Groq for multi-image analysis (Llama 4 supports multiple images)
    return analyzeMultipleWithGroq(imagesData);
}

// Analyze multiple images with Groq API
async function analyzeMultipleWithGroq(
    images: { base64: string; mimeType: string }[]
): Promise<AnalysisResult> {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY;

    if (!apiKey) {
        throw new Error("Groq API key not configured");
    }

    // Build content array with all images
    const contentParts: Array<{
        type: "text" | "image_url";
        text?: string;
        image_url?: { url: string };
    }> = [
            {
                type: "text",
                text: `${ANALYSIS_PROMPT}\n\nYou are analyzing ${images.length} images of the SAME item from different angles. Synthesize information from ALL images.`,
            },
        ];

    // Add all images
    for (const img of images) {
        contentParts.push({
            type: "image_url",
            image_url: {
                url: `data:${img.mimeType};base64,${img.base64}`,
            },
        });
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
                    content: contentParts,
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
1. Enhance the item name
2. Improve the description
3. Generate relevant tags
4. Identify the primary color
5. Identify the best category

Respond ONLY with valid JSON in this exact format:
{
  "name": "Enhanced Item Name",
  "description": "Enhanced detailed description here.",
  "tags": ["tag1", "tag2"],
  "color": "ColorName",
  "category": "CategoryName"
}`;

    const apiKey = provider === "groq"
        ? import.meta.env.VITE_GROQ_API_KEY
        : import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        // Return original if no API key
        return { name, description, tags: [], color: "", category: "Other" };
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
        return { name, description, tags: [], color: "", category: "Other" };
    }
}
