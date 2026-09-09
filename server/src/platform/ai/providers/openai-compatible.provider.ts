/**
 * One adapter for every provider that speaks the OpenAI chat-completions
 * shape: Groq, Grok, OpenAI itself, and a local runtime such as Ollama.
 *
 * Four providers, one wire format, one place to fix a bug in it. What differs
 * between them is data, not code: a base URL, a model, what the provider can
 * actually do, and what it costs. That is the registry's job, not this file's.
 */

import { createLogger } from '../../../utils/logger.js';
import { isRetryableStatus, ProviderError } from '../ai.errors.js';
import { schemaInstruction, type StructuredSpec } from '../structured.js';
import type {
  ChatImage,
  ChatMessage,
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ProviderCapabilities,
  ProviderCost,
} from '../ports/chat.port.js';

const log = createLogger('ai:openai-compatible');

/**
 * How far a provider will go to guarantee the shape of a reply.
 *
 * `json_schema` constrains it, `json_object` promises valid JSON of some
 * shape, `prompt` is an instruction and a hope. The router only routes a
 * structured request to a provider that declares `jsonSchema`, but the weaker
 * modes still improve the odds for the ones it does reach.
 */
export type StructuredMode = 'json_schema' | 'json_object' | 'prompt';

export interface OpenAiCompatibleConfig {
  id: string;
  /** Full chat-completions endpoint, not just the host. */
  url: string;
  apiKey?: string;
  model: string;
  capabilities: ProviderCapabilities;
  cost: ProviderCost;
  structuredMode: StructuredMode;
  /** The GPT-5 family renamed this field; everything else still takes the old one. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** False for models that accept only their default temperature. */
  supportsTemperature?: boolean;
}

interface TextPart {
  type: 'text';
  text: string;
}

interface ImagePart {
  type: 'image_url';
  image_url: { url: string };
}

interface CompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function imageParts(images: ChatImage[]): ImagePart[] {
  return images.map((image) => ({
    type: 'image_url',
    image_url: { url: `data:${image.mimeType || 'image/jpeg'};base64,${image.base64}` },
  }));
}

export class OpenAiCompatibleProvider implements ChatProvider {
  constructor(private readonly config: OpenAiCompatibleConfig) {}

  get id(): string {
    return this.config.id;
  }

  get model(): string {
    return this.config.model;
  }

  get capabilities(): ProviderCapabilities {
    return this.config.capabilities;
  }

  get cost(): ProviderCost {
    return this.config.cost;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.config.model,
      messages: this.buildMessages(request),
      ...(this.config.supportsTemperature === false
        ? {}
        : { temperature: request.temperature ?? 0.3 }),
      [this.config.maxTokensField ?? 'max_tokens']: request.maxTokens ?? 2048,
      ...this.responseFormat(request.structured),
    };

    const response = await this.post(body, request.signal);
    const data = (await response.json()) as CompletionResponse;

    return {
      content: data.choices?.[0]?.message?.content || '',
      providerId: this.id,
      model: this.config.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(this.config.url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // A transport failure has no status, and a local runtime that is not
      // running is the common case. Both are worth another provider. An abort
      // is not: somebody decided this call should stop, and the Anthropic
      // adapter already classifies it the same way.
      const aborted = error instanceof Error && error.name === 'AbortError';

      throw new ProviderError(this.id, describeTransport(error), undefined, !aborted);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      log.warn('Provider call failed', { provider: this.id, status: response.status });

      throw new ProviderError(
        this.id,
        `${this.id} returned ${response.status}: ${detail.slice(0, 200)}`,
        response.status,
        isRetryableStatus(response.status),
      );
    }

    return response;
  }

  /**
   * Images ride on the last user message, because that is the one they belong
   * to and duplicating them onto every turn would multiply the token bill.
   */
  private buildMessages(
    request: ChatRequest,
  ): Array<{ role: string; content: string | Array<TextPart | ImagePart> }> {
    const images = request.images ?? [];
    const structuredHint =
      request.structured && this.config.structuredMode !== 'json_schema'
        ? schemaInstruction(request.structured)
        : null;

    const messages: ChatMessage[] = structuredHint
      ? [...request.messages, { role: 'system', content: structuredHint }]
      : [...request.messages];

    const lastUser = messages.map((message) => message.role).lastIndexOf('user');

    return messages.map((message, index) => {
      if (index !== lastUser || images.length === 0) {
        return { role: message.role, content: message.content };
      }

      return {
        role: message.role,
        content: [{ type: 'text', text: message.content } as TextPart, ...imageParts(images)],
      };
    });
  }

  private responseFormat(structured?: StructuredSpec<unknown>): Record<string, unknown> {
    if (!structured) return {};

    if (this.config.structuredMode === 'json_schema') {
      return {
        response_format: {
          type: 'json_schema',
          json_schema: { name: structured.name, schema: structured.jsonSchema, strict: true },
        },
      };
    }

    if (this.config.structuredMode === 'json_object') {
      return { response_format: { type: 'json_object' } };
    }

    return {};
  }
}

function describeTransport(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' ? 'request aborted' : error.message;
  }

  return 'transport failure';
}
