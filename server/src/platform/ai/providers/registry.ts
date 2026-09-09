/**
 * The provider registry.
 *
 * Everything that differs between providers is data in this file: endpoint,
 * model, what it can do, what it costs. A provider that has no key is not
 * registered at all, so "configured" and "available" are the same question and
 * the router never has to ask twice.
 *
 * Adding a provider is an entry here plus, only if it speaks a new wire
 * format, one adapter file. No caller changes.
 *
 * Prices are US dollars per million tokens and are used for the cost meter and
 * for ordering candidates, never for billing. Each carries the date it was
 * checked; `unverified` means exactly that and is why `AI_*_MODEL` and the
 * pricing overrides exist.
 */

import { env } from '../../../config/env.js';
import { createLogger } from '../../../utils/logger.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';
import type { ChatProvider } from '../ports/chat.port.js';

const log = createLogger('ai:registry');

export const PROVIDER_IDS = ['groq', 'gemini', 'grok', 'openai', 'anthropic', 'local'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

type ProviderFactory = () => ChatProvider | null;

/**
 * Groq's `meta-llama/llama-4-scout-17b-16e-instruct`, which this application
 * used until now, was deprecated on 2026-06-17 for free and developer tiers,
 * with a shutdown date of 2026-07-17. Groq names two replacements:
 * `openai/gpt-oss-120b` and `qwen/qwen3.6-27b`. Only the second one takes
 * images, and this application sends images on two of its five tasks, so that
 * is the default. Set `GROQ_MODEL` to pin something else.
 */
const DEFAULT_MODELS = {
  groq: 'qwen/qwen3.6-27b',
  gemini: 'gemini-3.8-flash',
  grok: 'grok-2-vision-1212',
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5',
  local: 'llama3.2',
} as const;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1/models';

/**
 * Vision belongs to the model, not to the provider id.
 *
 * Groq is the only provider here whose catalogue mixes both: the same key
 * reaches multimodal Qwen and text-only `gpt-oss`. Declaring `vision: true`
 * for the id and then pointing `GROQ_MODEL` at a text model is a 400 the
 * router cannot retry and will not route around, so the capability is read off
 * the configured model. An unrecognised model is assumed text-only, which
 * costs a routing decision rather than a failed request.
 */
const GROQ_VISION_MODELS = new Set(['qwen/qwen3.6-27b', 'qwen/qwen3.8-27b']);

/** OpenAI models that take `max_completion_tokens` and no temperature. */
const OPENAI_COMPLETION_TOKEN_MODELS = /^(?:gpt-5|o\d)/;

const FACTORIES: Record<ProviderId, ProviderFactory> = {
  groq: () => {
    const apiKey = env.llm.groqApiKey;

    if (!apiKey) return null;

    const model = env.llm.groqModel || DEFAULT_MODELS.groq;

    return new OpenAiCompatibleProvider({
      id: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey,
      model,
      structuredMode: 'json_object',
      capabilities: {
        vision: GROQ_VISION_MODELS.has(model),
        tools: true,
        jsonSchema: false,
        maxContext: 131_072,
      },
      cost: { inputPerMTok: 0.15, outputPerMTok: 0.6, verifiedOn: '2026-09-09' },
    });
  },

  gemini: () => {
    const apiKey = env.llm.geminiApiKey;

    if (!apiKey) return null;

    return new GeminiProvider({
      id: 'gemini',
      apiKey,
      model: env.llm.geminiModel || DEFAULT_MODELS.gemini,
      baseUrl: GEMINI_BASE_URL,
      capabilities: { vision: true, tools: true, jsonSchema: false, maxContext: 1_000_000 },
      // Introductory rate to 2026-12-31; it doubles on 2027-01-01.
      cost: { inputPerMTok: 0.75, outputPerMTok: 3.75, verifiedOn: '2026-09-09' },
    });
  },

  grok: () => {
    const apiKey = env.llm.grokApiKey;

    if (!apiKey) return null;

    return new OpenAiCompatibleProvider({
      id: 'grok',
      url: 'https://api.x.ai/v1/chat/completions',
      apiKey,
      model: env.llm.grokModel || DEFAULT_MODELS.grok,
      structuredMode: 'json_object',
      capabilities: { vision: true, tools: true, jsonSchema: false, maxContext: 131_072 },
      cost: { inputPerMTok: 2, outputPerMTok: 10, verifiedOn: 'unverified' },
    });
  },

  openai: () => {
    const apiKey = env.llm.openaiApiKey;

    if (!apiKey) return null;

    const model = env.llm.openaiModel || DEFAULT_MODELS.openai;

    return new OpenAiCompatibleProvider({
      id: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey,
      model,
      structuredMode: 'json_schema',
      // The GPT-5 family renamed the token field and accepts only the default
      // temperature. Sending either the old way is a 400 on every request,
      // which would make the one provider that can constrain output unusable.
      maxTokensField: OPENAI_COMPLETION_TOKEN_MODELS.test(model)
        ? 'max_completion_tokens'
        : 'max_tokens',
      supportsTemperature: !OPENAI_COMPLETION_TOKEN_MODELS.test(model),
      capabilities: { vision: true, tools: true, jsonSchema: true, maxContext: 400_000 },
      cost: { inputPerMTok: 2, outputPerMTok: 12, verifiedOn: '2026-09-09' },
    });
  },

  anthropic: () => {
    const apiKey = env.llm.anthropicApiKey;

    if (!apiKey) return null;

    return new AnthropicProvider({
      id: 'anthropic',
      apiKey,
      model: env.llm.anthropicModel || DEFAULT_MODELS.anthropic,
      capabilities: { vision: true, tools: true, jsonSchema: true, maxContext: 200_000 },
      cost: { inputPerMTok: 1, outputPerMTok: 5, verifiedOn: '2026-06-24' },
    });
  },

  /**
   * A model on the developer's own machine, or anywhere else that speaks the
   * OpenAI shape. Free, private, and the reason a contributor with no keys can
   * still run the matching pipeline end to end.
   */
  local: () => {
    const url = env.llm.localUrl;

    if (!url) return null;

    return new OpenAiCompatibleProvider({
      id: 'local',
      url,
      model: env.llm.localModel || DEFAULT_MODELS.local,
      structuredMode: 'json_object',
      capabilities: { vision: false, tools: false, jsonSchema: false, maxContext: 32_768 },
      cost: { inputPerMTok: 0, outputPerMTok: 0, verifiedOn: 'local, no cost' },
    });
  },
};

export class ProviderRegistry {
  private readonly built = new Map<ProviderId, ChatProvider | null>();

  constructor(private readonly factories: Record<ProviderId, ProviderFactory> = FACTORIES) {}

  /** The provider, or null when it has no key and therefore does not exist. */
  get(id: ProviderId): ChatProvider | null {
    if (!this.built.has(id)) {
      let provider: ChatProvider | null = null;

      try {
        provider = this.factories[id]();
      } catch (error) {
        // A provider that cannot even be constructed must not stop the others.
        log.error('Provider could not be created', { provider: id, error });
      }

      this.built.set(id, provider);
    }

    return this.built.get(id) ?? null;
  }

  available(): ProviderId[] {
    return PROVIDER_IDS.filter((id) => this.get(id) !== null);
  }

  isAvailable(id: ProviderId): boolean {
    return this.get(id) !== null;
  }
}

export const providerRegistry = new ProviderRegistry();
