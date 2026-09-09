/**
 * Anthropic Claude, through the official SDK.
 *
 * The one provider here that is not hand-rolled fetch. The SDK is what
 * Anthropic documents for TypeScript, and it is what makes schema-constrained
 * output a real constraint (`messages.parse` with `output_config.format`)
 * rather than an instruction in a prompt.
 *
 * Two shape differences worth naming: the system prompt is a top-level field
 * rather than a message, and images are content blocks on the user turn.
 */

import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { createLogger } from '../../../utils/logger.js';
import { isRetryableStatus, ProviderError } from '../ai.errors.js';
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ProviderCapabilities,
  ProviderCost,
} from '../ports/chat.port.js';

const log = createLogger('ai:anthropic');

export interface AnthropicConfig {
  id: string;
  apiKey: string;
  model: string;
  capabilities: ProviderCapabilities;
  cost: ProviderCost;
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const SUPPORTED_MEDIA: readonly ImageMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

function mediaType(value: string | undefined): ImageMediaType {
  const candidate = (value || 'image/jpeg').toLowerCase();

  return SUPPORTED_MEDIA.includes(candidate as ImageMediaType)
    ? (candidate as ImageMediaType)
    : 'image/jpeg';
}

export class AnthropicProvider implements ChatProvider {
  private readonly client: Anthropic;

  constructor(private readonly config: AnthropicConfig) {
    // maxRetries 0 because the SDK otherwise retries twice on its own,
    // honouring `Retry-After` with no cap. Those sleeps happen inside one
    // `chat` call, where the router's per-attempt timeout fires first and the
    // careful 429 mapping below never reaches the breaker or the fallback.
    this.client = new Anthropic({ apiKey: config.apiKey, maxRetries: 0 });
  }

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
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');

    const turns = request.messages.filter((message) => message.role !== 'system');
    const images = request.images ?? [];
    const lastUser = turns.map((turn) => turn.role).lastIndexOf('user');

    const messages: Anthropic.MessageParam[] = turns.map((turn, index) => {
      const role = turn.role === 'assistant' ? 'assistant' : 'user';

      if (index !== lastUser || images.length === 0) {
        return { role, content: turn.content };
      }

      return {
        role,
        content: [
          ...images.map((image) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: mediaType(image.mimeType),
              data: image.base64,
            },
          })),
          { type: 'text' as const, text: turn.content },
        ],
      };
    });

    const common = {
      model: this.config.model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.3,
      ...(system ? { system } : {}),
      messages,
    };

    try {
      if (request.structured) {
        // The JSON Schema rather than the zod schema: the SDK zod helper is
        // built against zod 4 and this project is on zod 3, and the spec
        // carries both shapes for exactly this reason. Validation still
        // happens in the router, against the zod half.
        const format = jsonSchemaOutputFormat(
          request.structured.jsonSchema as Parameters<typeof jsonSchemaOutputFormat>[0],
        );

        const response = await this.client.messages.parse(
          { ...common, output_config: { format } },
          { signal: request.signal },
        );

        return this.toResponse(response);
      }

      const response = await this.client.messages.create(common, { signal: request.signal });

      return this.toResponse(response);
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  private toResponse(response: Anthropic.Message): ChatResponse {
    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      content,
      providerId: this.id,
      model: response.model || this.config.model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  }

  /**
   * The SDK raises typed errors, so the status is available rather than
   * guessed from a message.
   */
  private toProviderError(error: unknown): ProviderError {
    // Before the `APIError` branch, because it is a subclass of it and carries
    // no status. Falling through would price a network blip as a 0 and mark it
    // unretryable, which is the one case that most deserves another attempt.
    if (error instanceof Anthropic.APIConnectionError) {
      return new ProviderError(this.id, error.message, undefined, true);
    }

    if (error instanceof Anthropic.APIError) {
      const status = error.status ?? 0;

      log.warn('Provider call failed', { provider: this.id, status });

      return new ProviderError(this.id, error.message, status, isRetryableStatus(status));
    }

    return new ProviderError(
      this.id,
      error instanceof Error ? error.message : 'unknown Anthropic failure',
      undefined,
      false,
    );
  }
}
