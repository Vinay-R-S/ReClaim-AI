/**
 * The shared OpenAI-compatible adapter.
 *
 * Four providers run through this one file, so a mistake in it is a mistake in
 * all four. What matters is the request it builds (images on the right turn,
 * the right response_format for what the provider can do) and the errors it
 * raises, because the router routes on `retryable`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';
import { defineStructured } from '../structured.js';
import { ProviderError } from '../ai.errors.js';

const CAPABILITIES = { vision: true, tools: true, jsonSchema: true, maxContext: 128_000 };
const COST = { inputPerMTok: 1, outputPerMTok: 2, verifiedOn: 'test' };

const SPEC = defineStructured({
  name: 'verdict',
  schema: z.object({ score: z.number() }),
  jsonSchema: { type: 'object', properties: { score: { type: 'number' } } },
});

function providerWith(structuredMode: 'json_schema' | 'json_object' | 'prompt') {
  return new OpenAiCompatibleProvider({
    id: 'groq',
    url: 'https://example.test/v1/chat/completions',
    apiKey: 'test-key',
    model: 'test-model',
    structuredMode,
    capabilities: CAPABILITIES,
    cost: COST,
  });
}

function okResponse(content = 'hello') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    }),
  };
}

function bodyOf(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse((mock.mock.calls[0][1] as { body: string }).body);
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('sends the model, the messages and the bearer key', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await providerWith('json_object').chat({ messages: [{ role: 'user', content: 'hi' }] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(bodyOf(fetchMock)).toMatchObject({ model: 'test-model' });
  });

  it('returns the content and the token counts', async () => {
    fetchMock.mockResolvedValue(okResponse('the answer'));

    const response = await providerWith('json_object').chat({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response).toMatchObject({
      content: 'the answer',
      providerId: 'groq',
      usage: { inputTokens: 12, outputTokens: 34 },
    });
  });

  /**
   * Images belong to the turn that asked about them. Repeating them on every
   * user turn would multiply the token bill for no extra information.
   */
  it('attaches images to the last user message only', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await providerWith('json_object').chat({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'look at this' },
      ],
      images: [{ base64: 'AAAA', mimeType: 'image/png' }],
    });

    const messages = bodyOf(fetchMock).messages as Array<{ role: string; content: unknown }>;

    expect(messages[0].content).toBe('first');
    expect(messages[2].content).toEqual([
      { type: 'text', text: 'look at this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('defaults an image with no media type to jpeg', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await providerWith('json_object').chat({
      messages: [{ role: 'user', content: 'look' }],
      images: [{ base64: 'AAAA' }],
    });

    const messages = bodyOf(fetchMock).messages as Array<{
      content: Array<{ image_url?: { url: string } }>;
    }>;

    expect(messages[0].content[1].image_url?.url).toContain('data:image/jpeg;base64,');
  });
});

describe('structured output', () => {
  it('sends the schema when the provider can constrain the reply', async () => {
    fetchMock.mockResolvedValue(okResponse('{"score":1}'));

    await providerWith('json_schema').chat({
      messages: [{ role: 'user', content: 'score it' }],
      structured: SPEC,
    });

    const body = bodyOf(fetchMock);

    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'verdict', strict: true },
    });
    // A provider that constrains the reply does not need to be asked in prose.
    expect(JSON.stringify(body.messages)).not.toContain('JSON object and nothing else');
  });

  it('asks for JSON and states the schema when it can only promise JSON', async () => {
    fetchMock.mockResolvedValue(okResponse('{"score":1}'));

    await providerWith('json_object').chat({
      messages: [{ role: 'user', content: 'score it' }],
      structured: SPEC,
    });

    const body = bodyOf(fetchMock);

    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(body.messages)).toContain('JSON object and nothing else');
  });

  it('sends no response_format at all when the request is not structured', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await providerWith('json_schema').chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(bodyOf(fetchMock).response_format).toBeUndefined();
  });
});

describe('errors', () => {
  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [404, false],
  ])('maps status %s to retryable %s', async (status, retryable) => {
    fetchMock.mockResolvedValue({ ok: false, status, text: async () => 'nope' });

    const error = await providerWith('json_object')
      .chat({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ providerId: 'groq', status, retryable });
  });

  /** A local runtime that is not running is the everyday case of this. */
  it('treats a transport failure as retryable, so the next provider is tried', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await providerWith('json_object')
      .chat({ messages: [{ role: 'user', content: 'hi' }] })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ retryable: true, status: undefined });
  });
});
