/**
 * Google Gemini.
 *
 * Its own file because the request shape is genuinely different: one `contents`
 * array of parts rather than a message list, images as `inline_data`, and the
 * key on the query string instead of a header.
 */

import { createLogger } from '../../../utils/logger.js';
import { isRetryableStatus, ProviderError } from '../ai.errors.js';
import { schemaInstruction } from '../structured.js';
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ProviderCapabilities,
  ProviderCost,
} from '../ports/chat.port.js';

const log = createLogger('ai:gemini');

export interface GeminiConfig {
  id: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  capabilities: ProviderCapabilities;
  cost: ProviderCost;
}

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GeminiResponsePart {
  text?: string;
  /** A reasoning part. Billed, and not part of the answer. */
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiResponsePart[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

/**
 * A reply is every answer part joined, not the first one.
 *
 * A reasoning model emits thought parts alongside the answer, and a long reply
 * is split across parts. Taking `parts[0]` returns the model's thinking, or
 * the first third of the answer, with a 200 status and nothing in the log to
 * say what happened.
 */
function textOf(response: GeminiResponse): string {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

export class GeminiProvider implements ChatProvider {
  constructor(private readonly config: GeminiConfig) {}

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
    const parts = this.buildParts(request);
    const url = `${this.config.baseUrl}/${this.config.model}:generateContent`;

    const body = {
      contents: [{ parts }],
      generationConfig: {
        temperature: request.temperature ?? 0.3,
        maxOutputTokens: request.maxTokens ?? 2048,
        // The model still has to be told the shape; this only guarantees that
        // what comes back parses as JSON.
        ...(request.structured ? { responseMimeType: 'application/json' } : {}),
      },
    };

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        signal: request.signal,
        // In a header rather than the query string it used to ride in: a URL
        // reaches proxy logs, gateway logs and any HTTP instrumentation that
        // records a request line, and this is a full-privilege key.
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';

      throw new ProviderError(
        this.id,
        error instanceof Error ? error.message : 'transport failure',
        undefined,
        !aborted,
      );
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

    const data = (await response.json()) as GeminiResponse;

    return {
      content: textOf(data),
      providerId: this.id,
      model: this.config.model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        // Reasoning tokens are billed as output. Leaving them out understates
        // the bill and lets the ceiling be walked straight through.
        outputTokens:
          (data.usageMetadata?.candidatesTokenCount ?? 0) +
          (data.usageMetadata?.thoughtsTokenCount ?? 0),
      },
    };
  }

  /**
   * Gemini has no roles in this endpoint, so the conversation is flattened
   * with the speaker named in the text. That is what the previous
   * implementation did and what the prompts in this application are written
   * against.
   */
  private buildParts(request: ChatRequest): GeminiPart[] {
    const parts: GeminiPart[] = [];

    request.messages.forEach((message) => {
      if (message.role === 'system') {
        parts.push({ text: `System: ${message.content}\n\n` });
        return;
      }

      const speaker = message.role === 'user' ? 'User' : 'Assistant';
      parts.push({ text: `${speaker}: ${message.content}\n` });
    });

    if (request.structured) {
      parts.push({ text: schemaInstruction(request.structured) });
    }

    (request.images ?? []).forEach((image) => {
      parts.push({
        inline_data: { mime_type: image.mimeType || 'image/jpeg', data: image.base64 },
      });
    });

    return parts;
  }
}
