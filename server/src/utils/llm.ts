/**
 * LLM Utility - Wrapper for Groq and Gemini APIs
 * Handles model calls with automatic failover between providers
 */

export type LLMProvider = 'groq' | 'gemini' | 'grok';

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMOptions {
    provider?: LLMProvider;
    temperature?: number;
    maxTokens?: number;
    imageBase64?: string;
    imageMimeType?: string;
}

interface LLMResponse {
    content: string;
    provider: LLMProvider;
    tokensUsed?: number;
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

/**
 * Call Groq API
 */
async function callGroq(
    messages: LLMMessage[],
    options: LLMOptions = {}
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    if (!apiKey) {
        throw new Error('Groq API key not configured');
    }

    const { temperature = 0.3, maxTokens = 2048, imageBase64, imageMimeType } = options;

    // Build messages with optional image
    const formattedMessages = messages.map(msg => {
        if (msg.role === 'user' && imageBase64) {
            return {
                role: msg.role,
                content: [
                    { type: 'text', text: msg.content },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}`,
                        },
                    },
                ],
            };
        }
        return { role: msg.role, content: msg.content };
    });

    const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'meta-llama/llama-4-scout-17b-16e-instruct', // User preferred model
            messages: formattedMessages,
            temperature,
            max_tokens: maxTokens,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Groq API error: ${error}`);
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '';
}

/**
 * Call Grok API (xAI)
 */
async function callGrok(
    messages: LLMMessage[],
    options: LLMOptions = {}
): Promise<string> {
    const apiKey = process.env.GROK_API_KEY || process.env.VITE_GROK_API_KEY;

    if (!apiKey) {
        throw new Error('Grok API key not configured');
    }

    const { temperature = 0.3, maxTokens = 2048, imageBase64, imageMimeType } = options;

    // Build messages with optional image (OpenAI-compatible format)
    const formattedMessages = messages.map(msg => {
        if (msg.role === 'user' && imageBase64) {
            return {
                role: msg.role,
                content: [
                    { type: 'text', text: msg.content },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}`,
                        },
                    },
                ],
            };
        }
        return { role: msg.role, content: msg.content };
    });

    const response = await fetch(GROK_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'grok-2-vision-1212', // Latest Grok vision model
            messages: formattedMessages,
            temperature,
            max_tokens: maxTokens,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Grok API error: ${error}`);
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '';
}

/**
 * Call Gemini API
 */
async function callGemini(
    messages: LLMMessage[],
    options: LLMOptions = {}
): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error('Gemini API key not configured');
    }

    const { temperature = 0.3, maxTokens = 2048, imageBase64, imageMimeType } = options;

    // Build parts for Gemini
    const parts: any[] = [];

    // Add system message if present
    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg) {
        parts.push({ text: `System: ${systemMsg.content}\n\n` });
    }

    // Add conversation history
    for (const msg of messages.filter(m => m.role !== 'system')) {
        const prefix = msg.role === 'user' ? 'User' : 'Assistant';
        parts.push({ text: `${prefix}: ${msg.content}\n` });
    }

    // Add image if provided
    if (imageBase64) {
        parts.push({
            inline_data: {
                mime_type: imageMimeType || 'image/jpeg',
                data: imageBase64,
            },
        });
    }

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens,
            },
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

import { collections } from './firebase-admin.js';

type AIProviderSetting = 'groq_only' | 'gemini_only' | 'grok_only' | 'groq_with_fallback' | 'gemini_with_fallback' | 'grok_with_fallback';

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
        const provider: AIProviderSetting = data?.aiProvider || 'groq_only'; // Default to groq_only
        cachedAIProvider = provider;
        lastSettingsFetch = now;
        return provider;
    } catch (error) {
        console.warn('Failed to fetch AI provider settings, using default:', error);
        return 'groq_only';
    }
}

/**
 * Main LLM call function with configurable provider based on settings
 */
export async function callLLM(
    messages: LLMMessage[],
    options: LLMOptions = {}
): Promise<LLMResponse> {
    const providerSetting = await getAIProviderSetting();

    // Determine primary and fallback providers based on setting
    const useFallback = providerSetting.includes('fallback');
    let primaryProvider: LLMProvider = 'groq';
    if (providerSetting.startsWith('gemini')) primaryProvider = 'gemini';
    if (providerSetting.startsWith('grok')) primaryProvider = 'grok';

    let fallbackProvider: LLMProvider;
    switch (primaryProvider) {
        case 'groq':
            fallbackProvider = 'gemini';
            break;
        case 'gemini':
            fallbackProvider = 'grok';
            break;
        case 'grok':
            fallbackProvider = 'groq';
            break;
        default:
            fallbackProvider = 'gemini';
    }

    // Try primary provider
    try {
        if (primaryProvider === 'groq') {
            const content = await callGroq(messages, options);
            return { content, provider: 'groq' };
        } else if (primaryProvider === 'grok') {
            const content = await callGrok(messages, options);
            return { content, provider: 'grok' };
        } else {
            const content = await callGemini(messages, options);
            return { content, provider: 'gemini' };
        }
    } catch (error) {
        console.warn(`${primaryProvider} failed:`, error);

        // Only try fallback if enabled
        if (!useFallback) {
            throw new Error(`${primaryProvider} provider failed and no fallback is configured`);
        }

        console.log(`Falling back to ${fallbackProvider}...`);

        // Try fallback provider
        try {
            if (fallbackProvider === 'groq') {
                const content = await callGroq(messages, options);
                return { content, provider: 'groq' };
            } else if (fallbackProvider === 'grok') {
                const content = await callGrok(messages, options);
                return { content, provider: 'grok' };
            } else {
                const content = await callGemini(messages, options);
                return { content, provider: 'gemini' };
            }
        } catch (fallbackError) {
            console.error('Both LLM providers failed:', fallbackError);
            throw new Error('All LLM providers unavailable');
        }
    }
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
export function parseJSONFromLLM<T>(content: string): T | null {
    try {
        let jsonStr = content;

        // Extract from markdown code block if present
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }

        return JSON.parse(jsonStr.trim()) as T;
    } catch (error) {
        console.error('Failed to parse JSON from LLM:', error);
        return null;
    }
}

/**
 * Check which providers are available
 */
export function getAvailableProviders(): LLMProvider[] {
    const providers: LLMProvider[] = [];

    if (process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY) {
        providers.push('groq');
    }
    if (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY) {
        providers.push('gemini');
    }
    if (process.env.GROK_API_KEY || process.env.VITE_GROK_API_KEY) {
        providers.push('grok');
    }

    return providers;
}
