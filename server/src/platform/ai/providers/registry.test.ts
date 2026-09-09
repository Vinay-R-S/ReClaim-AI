/**
 * The registry, which is where a provider's capabilities are declared.
 *
 * The one that has to be read off the model rather than the id is vision:
 * Groq's catalogue mixes multimodal and text-only models behind one key, and
 * declaring `vision: true` for a text-only model sends every image request to
 * a 400 the router cannot retry and will not route around.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const llm: Record<string, string | undefined> = {};

vi.mock('../../../config/env.js', () => ({
  env: {
    get llm() {
      return llm;
    },
  },
}));

const { ProviderRegistry, PROVIDER_IDS, isProviderId } = await import('./registry.js');

function registry() {
  return new ProviderRegistry();
}

beforeEach(() => {
  Object.keys(llm).forEach((key) => delete llm[key]);
});

describe('provider registry', () => {
  it('registers nothing when no key is set', () => {
    expect(registry().available()).toEqual([]);
  });

  it('registers only the providers that have a key', () => {
    llm.groqApiKey = 'test';
    llm.localUrl = 'http://localhost:11434/v1/chat/completions';

    expect(registry().available()).toEqual(['groq', 'local']);
  });

  it('declares vision for the multimodal Groq default', () => {
    llm.groqApiKey = 'test';

    expect(registry().get('groq')?.capabilities.vision).toBe(true);
  });

  it('withholds vision when GROQ_MODEL names a text-only model', () => {
    llm.groqApiKey = 'test';
    llm.groqModel = 'openai/gpt-oss-120b';

    const groq = registry().get('groq');

    expect(groq?.model).toBe('openai/gpt-oss-120b');
    expect(groq?.capabilities.vision).toBe(false);
  });

  it('treats an unrecognised Groq model as text-only rather than assuming', () => {
    llm.groqApiKey = 'test';
    llm.groqModel = 'something/not-in-the-table';

    expect(registry().get('groq')?.capabilities.vision).toBe(false);
  });

  it('knows which ids exist', () => {
    expect(PROVIDER_IDS).toContain('anthropic');
    expect(isProviderId('groq')).toBe(true);
    expect(isProviderId('mistral')).toBe(false);
  });

  it('builds a provider once and reuses it', () => {
    llm.geminiApiKey = 'test';

    const built = registry();

    expect(built.get('gemini')).toBe(built.get('gemini'));
  });
});
