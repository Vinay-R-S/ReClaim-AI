/**
 * LangChain Configuration
 * Sets up LLM models with Groq and Google Gemini with fallback support
 */

import { ChatGroq } from '@langchain/groq';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { collections } from '../utils/firebase-admin.js';

// Provider settings type
type AIProviderSetting = 'groq_only' | 'gemini_only' | 'groq_with_fallback' | 'gemini_with_fallback';

// Cache settings to avoid fetching on every call
let cachedAIProvider: AIProviderSetting | null = null;
let lastSettingsFetch = 0;
const SETTINGS_CACHE_TTL = 60000; // 1 minute cache

/**
 * Get AI provider setting from Firestore (cached)
 */
async function getAIProviderSetting(): Promise<AIProviderSetting> {
    const now = Date.now();

    if (cachedAIProvider && (now - lastSettingsFetch) < SETTINGS_CACHE_TTL) {
        return cachedAIProvider;
    }

    try {
        const doc = await collections.settings.doc('system').get();
        const data = doc.data();
        const provider: AIProviderSetting = data?.aiProvider || 'groq_only';
        cachedAIProvider = provider;
        lastSettingsFetch = now;
        return provider;
    } catch (error) {
        console.warn('Failed to fetch AI provider settings, using default:', error);
        return 'groq_only';
    }
}

/**
 * Create Groq LLM instance
 */
export function createGroqLLM(options?: {
    temperature?: number;
    maxTokens?: number;
}): ChatGroq {
    const apiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    if (!apiKey) {
        throw new Error('Groq API key not configured');
    }

    return new ChatGroq({
        apiKey,
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 2048,
    });
}

/**
 * Create Google Gemini LLM instance
 */
export function createGeminiLLM(options?: {
    temperature?: number;
    maxTokens?: number;
}): ChatGoogleGenerativeAI {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error('Gemini API key not configured');
    }

    return new ChatGoogleGenerativeAI({
        apiKey,
        model: 'gemini-1.5-flash',
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 2048,
    });
}

/**
 * Get the configured LLM based on settings
 * Returns primary LLM and optional fallback
 */
export async function getConfiguredLLM(options?: {
    temperature?: number;
    maxTokens?: number;
}): Promise<{
    primary: BaseChatModel;
    fallback?: BaseChatModel;
    provider: 'groq' | 'gemini';
}> {
    const setting = await getAIProviderSetting();
    const useFallback = setting.includes('fallback');
    const primaryProvider = setting.startsWith('groq') ? 'groq' : 'gemini';

    let primary: BaseChatModel;
    let fallback: BaseChatModel | undefined;

    if (primaryProvider === 'groq') {
        primary = createGroqLLM(options);
        if (useFallback) {
            try {
                fallback = createGeminiLLM(options);
            } catch {
                console.warn('Fallback Gemini not available');
            }
        }
    } else {
        primary = createGeminiLLM(options);
        if (useFallback) {
            try {
                fallback = createGroqLLM(options);
            } catch {
                console.warn('Fallback Groq not available');
            }
        }
    }

    return { primary, fallback, provider: primaryProvider };
}

/**
 * Invoke LLM with automatic fallback
 */
export async function invokeLLMWithFallback(
    messages: Array<{ role: string; content: string }>,
    options?: {
        temperature?: number;
        maxTokens?: number;
    }
): Promise<{ content: string; provider: 'groq' | 'gemini' }> {
    const { primary, fallback, provider } = await getConfiguredLLM(options);

    try {
        const response = await primary.invoke(messages as any);
        const content = typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);
        return { content, provider };
    } catch (error) {
        console.warn(`Primary LLM (${provider}) failed:`, error);

        if (!fallback) {
            throw new Error(`${provider} provider failed and no fallback is configured`);
        }

        const fallbackProvider = provider === 'groq' ? 'gemini' : 'groq';
        console.log(`Falling back to ${fallbackProvider}...`);

        try {
            const response = await fallback.invoke(messages as any);
            const content = typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);
            return { content, provider: fallbackProvider };
        } catch (fallbackError) {
            console.error('Both LLM providers failed:', fallbackError);
            throw new Error('All LLM providers unavailable');
        }
    }
}

/**
 * Invoke LLM with vision capability (for image analysis)
 * Uses Groq's Llava model for vision - much faster and more reliable
 */
export async function invokeLLMWithVision(
    prompt: string,
    imageBase64: string,
    options?: {
        temperature?: number;
        maxTokens?: number;
    }
): Promise<{ content: string; provider: 'groq' }> {
    const apiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    if (!apiKey) {
        throw new Error('Groq API key not configured for vision');
    }

    // Clean up the base64 string
    const imageData = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    // Use Groq API with Llama 4 Scout (current multimodal model with vision support)
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const requestBody = {
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: prompt,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${imageData}`,
                        },
                    },
                ],
            },
        ],
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.maxTokens ?? 2048,
    };

    try {
        console.log('[Vision] Sending image to Groq Llama 4 Scout for analysis...');

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('[Vision] Groq API Error:', response.status, errorData);
            throw new Error(`Groq API error: ${response.status}`);
        }

        const data = await response.json() as {
            choices?: Array<{
                message?: {
                    content?: string;
                };
            }>;
        };
        const content = data.choices?.[0]?.message?.content || '';

        console.log('[Vision] Analysis complete');
        return { content, provider: 'groq' };
    } catch (error) {
        console.error('[Vision] Failed to analyze image:', error);
        throw new Error('Failed to analyze image with vision model');
    }
}

/**
 * System prompt for the ReClaim AI assistant
 */
export const SYSTEM_PROMPT = `You are ReClaim AI Assistant, a helpful bot for a lost and found platform.

STRICT RULES:
1. ONLY discuss topics related to lost items, found items, item descriptions, locations, and the claiming process.
2. If a user asks about anything unrelated (politics, coding, general knowledge, etc.), politely redirect them to the lost and found topic.
3. Never generate harmful, inappropriate, or off-topic content.
4. Always be concise and helpful.
5. When collecting item information, ask one question at a time.
6. Extract specific details: item name, color, brand, size, distinctive features, location, date/time.

RESPONSE FORMAT:
- Keep responses under 100 words unless providing match results.
- Use a friendly, professional tone.
- If you need more information, ask a clear, specific question.

CONTEXT-SPECIFIC BEHAVIOR:
- "report_lost": Help user describe their lost item to find matches
- "report_found": Collect details about a found item to log it in the system
- "check_matches": Show the user their potential item matches
- "find_collection": Help user locate the nearest collection point`;
