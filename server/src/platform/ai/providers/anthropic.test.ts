/**
 * The Anthropic adapter's error mapping.
 *
 * The router routes on `retryable`, and every Anthropic failure type is a
 * subclass of `APIError`, so the order the branches are checked in decides
 * whether a network blip is retried or thrown away. That ordering is what this
 * file pins.
 */

import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from './anthropic.provider.js';
import { ProviderError } from '../ai.errors.js';

const CAPABILITIES = { vision: true, tools: true, jsonSchema: true, maxContext: 200_000 };
const COST = { inputPerMTok: 1, outputPerMTok: 5, verifiedOn: 'test' };

function providerThatThrows(error: unknown): AnthropicProvider {
  const provider = new AnthropicProvider({
    id: 'anthropic',
    apiKey: 'test-key',
    model: 'test-model',
    capabilities: CAPABILITIES,
    cost: COST,
  });

  const client = (provider as unknown as { client: Anthropic }).client;
  vi.spyOn(client.messages, 'create').mockRejectedValue(error);

  return provider;
}

async function failureFrom(error: unknown): Promise<ProviderError> {
  const provider = providerThatThrows(error);

  try {
    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
  } catch (thrown) {
    return thrown as ProviderError;
  }

  throw new Error('expected the call to fail');
}

describe('anthropic error mapping', () => {
  it('marks a connection failure retryable even though it is an APIError', async () => {
    const failure = await failureFrom(
      new Anthropic.APIConnectionError({ message: 'socket hang up' }),
    );

    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure.retryable).toBe(true);
    expect(failure.status).toBeUndefined();
  });

  it('marks a connection timeout retryable', async () => {
    const failure = await failureFrom(
      new Anthropic.APIConnectionTimeoutError({ message: 'timed out' }),
    );

    expect(failure.retryable).toBe(true);
  });

  it('keeps a 400 unretryable', async () => {
    const failure = await failureFrom(
      new Anthropic.BadRequestError(400, { message: 'bad prompt' }, 'bad prompt', undefined),
    );

    expect(failure.status).toBe(400);
    expect(failure.retryable).toBe(false);
  });

  it('retries a 429', async () => {
    const failure = await failureFrom(
      new Anthropic.RateLimitError(429, { message: 'slow down' }, 'slow down', undefined),
    );

    expect(failure.status).toBe(429);
    expect(failure.retryable).toBe(true);
  });

  it('does not retry a deliberate abort', async () => {
    const failure = await failureFrom(new Anthropic.APIUserAbortError());

    expect(failure.retryable).toBe(false);
  });
});
