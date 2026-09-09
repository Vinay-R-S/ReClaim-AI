/**
 * The router, against fake providers.
 *
 * What is worth pinning is everything the old switch statement did not do: a
 * request only reaches a provider that can serve it, a failure moves to the
 * next one rather than to the caller, a provider that is down is skipped
 * rather than waited on, an answer already known is not paid for twice, and a
 * budget refusal stops the whole call instead of shopping around.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

const getSystem = vi.fn(async () => ({ aiProvider: 'groq_with_fallback' }));

vi.mock('../../../repositories/settings.repository.js', () => ({
  SettingsRepository: class {},
  settingsRepository: { getSystem: () => getSystem() },
}));

const { AiRouter } = await import('./router.js');
const { CircuitBreaker } = await import('./breaker.js');
const { resetPolicyCache } = await import('./policy.js');
const { defineStructured } = await import('../structured.js');
const { BudgetExceededError, NoProviderAvailableError, ProviderError } =
  await import('../ai.errors.js');

type Capabilities = import('../ports/chat.port.js').ProviderCapabilities;
type ChatProvider = import('../ports/chat.port.js').ChatProvider;

const FULL: Capabilities = { vision: true, tools: true, jsonSchema: true, maxContext: 100_000 };
const TEXT_ONLY: Capabilities = {
  vision: false,
  tools: false,
  jsonSchema: false,
  maxContext: 8_000,
};

function provider(id: string, overrides: Partial<ChatProvider> = {}): ChatProvider {
  return {
    id,
    model: `${id}-model`,
    capabilities: FULL,
    cost: { inputPerMTok: 1, outputPerMTok: 2, verifiedOn: 'test' },
    chat: vi.fn(async () => ({
      content: `answer from ${id}`,
      providerId: id,
      model: `${id}-model`,
      usage: { inputTokens: 1_000, outputTokens: 500 },
    })),
    ...overrides,
  } as ChatProvider;
}

/** A registry over a plain map, so a test decides exactly who exists. */
function registryOf(providers: ChatProvider[]) {
  const byId = new Map(providers.map((entry) => [entry.id, entry]));

  return {
    get: (id: string) => byId.get(id) ?? null,
    available: () => [...byId.keys()],
    isAvailable: (id: string) => byId.has(id),
  };
}

function fakeCache() {
  const store = new Map<string, unknown>();

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function fakeCosts(overrides: Partial<{ assertWithinBudget: () => Promise<void> }> = {}) {
  return {
    assertWithinBudget: vi.fn(async () => undefined),
    record: vi.fn(async () => undefined),
    ...overrides,
  };
}

const allowAll = { tryAcquire: vi.fn(async () => true) };

/* eslint-disable @typescript-eslint/no-explicit-any */
function routerWith(
  providers: ChatProvider[],
  parts: {
    cache?: ReturnType<typeof fakeCache>;
    breaker?: InstanceType<typeof CircuitBreaker>;
    limiter?: { tryAcquire: (key: string) => Promise<boolean> };
    costs?: ReturnType<typeof fakeCosts>;
  } = {},
) {
  const cache = parts.cache ?? fakeCache();
  const breaker = parts.breaker ?? new CircuitBreaker();
  const limiter = parts.limiter ?? allowAll;
  const costs = parts.costs ?? fakeCosts();

  return {
    router: new AiRouter(
      registryOf(providers) as any,
      cache as any,
      breaker,
      limiter as any,
      costs as any,
    ),
    cache,
    breaker,
    limiter,
    costs,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const VERDICT = defineStructured({
  name: 'verdict',
  schema: z.object({ score: z.number(), verdict: z.enum(['same', 'different']) }),
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'verdict'],
    properties: { score: { type: 'number' }, verdict: { enum: ['same', 'different'] } },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  resetPolicyCache();
  getSystem.mockResolvedValue({ aiProvider: 'groq_with_fallback' });
});

describe('routing', () => {
  it('uses the provider the admin setting makes primary', async () => {
    const groq = provider('groq');
    const gemini = provider('gemini');
    const { router } = routerWith([groq, gemini]);

    const response = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(response.providerId).toBe('groq');
    expect(gemini.chat).not.toHaveBeenCalled();
  });

  it('honours a provider setting that names no fallback', async () => {
    getSystem.mockResolvedValue({ aiProvider: 'gemini_only' });

    const gemini = provider('gemini', {
      chat: vi.fn(async () => {
        throw new ProviderError('gemini', 'down', 500, true);
      }),
    });
    const groq = provider('groq');
    const { router } = routerWith([gemini, groq]);

    await expect(
      router.chat('match.semantic', { messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('down');
    expect(groq.chat).not.toHaveBeenCalled();
  });

  it('falls through to the next provider when the first fails', async () => {
    const groq = provider('groq', {
      chat: vi.fn(async () => {
        throw new ProviderError('groq', 'boom', 500, true);
      }),
    });
    const gemini = provider('gemini');
    const { router } = routerWith([groq, gemini]);

    const response = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.providerId).toBe('gemini');
  });

  /**
   * A 400 is the prompt, not the provider. Retrying it spends the same money
   * to get the same refusal.
   */
  it('does not retry a provider that refused the request', async () => {
    const chat = vi.fn(async () => {
      throw new ProviderError('groq', 'bad request', 400, false);
    });
    const { router } = routerWith([provider('groq', { chat }), provider('gemini')]);

    await router.chat('match.semantic', { messages: [{ role: 'user', content: 'hi' }] });

    expect(chat).toHaveBeenCalledTimes(1);
  });

  /**
   * A timeout arrives as a `TimeoutError`, which carries no status, so without
   * translation it is never retryable and the attempt budget is dead for the
   * one failure it was most obviously written for. The scorer this replaced
   * retried a slow provider once.
   */
  it('retries a provider that timed out', async () => {
    const chat = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 50_000).unref();
          }),
      )
      .mockResolvedValueOnce({ content: 'ok', providerId: 'groq', model: 'groq-model' });
    const { router } = routerWith([provider('groq', { chat })]);

    vi.useFakeTimers();

    const call = router.chat('match.semantic', { messages: [{ role: 'user', content: 'hi' }] });

    await vi.advanceTimersByTimeAsync(16_000);
    await vi.advanceTimersByTimeAsync(1_000);

    const response = await call;

    vi.useRealTimers();

    expect(chat).toHaveBeenCalledTimes(2);
    expect(response.providerId).toBe('groq');
  });

  it('retries a retryable failure against the same provider first', async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('groq', 'rate limited', 429, true))
      .mockResolvedValueOnce({ content: 'ok', providerId: 'groq', model: 'groq-model' });
    const gemini = provider('gemini');
    const { router } = routerWith([provider('groq', { chat }), gemini]);

    const response = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(response.providerId).toBe('groq');
    expect(gemini.chat).not.toHaveBeenCalled();
  });

  it('sends images only to a provider that can see them', async () => {
    const groq = provider('groq', { capabilities: TEXT_ONLY });
    const gemini = provider('gemini');
    const { router } = routerWith([groq, gemini]);

    const response = await router.chat('item.analyze', {
      messages: [{ role: 'user', content: 'what is this' }],
      images: [{ base64: 'AAAA', mimeType: 'image/png' }],
    });

    expect(groq.chat).not.toHaveBeenCalled();
    expect(response.providerId).toBe('gemini');
  });

  it('says so when nothing configured can serve the request', async () => {
    const { router } = routerWith([provider('groq', { capabilities: TEXT_ONLY })]);

    await expect(
      router.chat('item.analyze', {
        messages: [{ role: 'user', content: 'what is this' }],
        images: [{ base64: 'AAAA' }],
      }),
    ).rejects.toBeInstanceOf(NoProviderAvailableError);
  });

  it('reports having no provider at all as its own reason', async () => {
    const { router } = routerWith([]);

    await expect(
      router.chat('match.semantic', { messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/no provider is configured/);
  });
});

describe('circuit breaker', () => {
  /**
   * A half-open probe that is taken and never resolved leaves the provider
   * probing forever: `state` stays half-open, `allows` refuses everyone after
   * it, and the provider is dead for the life of the process even once it
   * recovers. The two guards that can refuse before a call is made are the
   * spend ceiling and the local rate budget.
   */
  it('does not wedge a half-open provider when a guard refuses before the call', async () => {
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 0 });
    const limiter = { tryAcquire: vi.fn(async () => false) };
    const groq = provider('groq');
    const { router } = routerWith([groq], { breaker, limiter });

    breaker.recordFailure('groq:cctv.verify');
    expect(breaker.state('groq:cctv.verify')).toBe('half-open');

    await expect(
      router.chat('cctv.verify', { messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/rate budget/);

    // The probe was handed back, so the next caller can still take one.
    expect(breaker.allows('groq:cctv.verify')).toBe(true);
  });

  /**
   * The breaker is keyed on the provider and the task, not the provider alone.
   *
   * Two tasks on one provider fail for different reasons and at different
   * sizes: a batched rerank sends twenty candidates against a 45-second
   * ceiling, a pair score sends two lines against fifteen. Keyed provider-wide,
   * the batch's timeouts opened the circuit and the per-pair scorer that was
   * meant to be the fallback ran straight into it and returned nothing for
   * every candidate, which the matching pipeline turns into no matches at all.
   */
  it("does not let one task's failures open the circuit for another", async () => {
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
    const groq = provider('groq');
    const { router } = routerWith([groq], { breaker });

    breaker.recordFailure('groq:match.rerank');

    const response = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.providerId).toBe('groq');
    expect(groq.chat).toHaveBeenCalledTimes(1);
  });

  it('skips a provider whose circuit is open instead of waiting on it', async () => {
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
    const groq = provider('groq');
    const gemini = provider('gemini');
    const { router } = routerWith([groq, gemini], { breaker });

    breaker.recordFailure('groq:match.semantic');

    const response = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(groq.chat).not.toHaveBeenCalled();
    expect(response.providerId).toBe('gemini');
  });

  it('opens the circuit after a provider keeps failing', async () => {
    const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 60_000 });
    const chat = vi.fn(async () => {
      throw new ProviderError('groq', 'down', 503, true);
    });
    const { router } = routerWith([provider('groq', { chat }), provider('gemini')], { breaker });

    await router.chat('match.semantic', { messages: [{ role: 'user', content: 'hi' }] });

    expect(breaker.state('groq:match.semantic')).toBe('open');
  });
});

describe('cache', () => {
  it('returns a cached answer without calling the provider again', async () => {
    const cache = fakeCache();
    const groq = provider('groq');
    const { router } = routerWith([groq], { cache });

    const first = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'same question' }],
    });
    const second = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'same question' }],
    });

    expect(groq.chat).toHaveBeenCalledTimes(1);
    expect(second.content).toBe(first.content);
    expect(second.cached).toBe(true);
    expect(second.costUsd).toBe(0);
  });

  it('does not cache a task whose policy sets no TTL', async () => {
    const cache = fakeCache();
    const groq = provider('groq');
    const { router } = routerWith([groq], { cache });

    await router.chat('item.enhance', { messages: [{ role: 'user', content: 'describe' }] });
    await router.chat('item.enhance', { messages: [{ role: 'user', content: 'describe' }] });

    expect(groq.chat).toHaveBeenCalledTimes(2);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('treats a different question as a different key', async () => {
    const groq = provider('groq');
    const { router } = routerWith([groq]);

    await router.chat('match.semantic', { messages: [{ role: 'user', content: 'a' }] });
    await router.chat('match.semantic', { messages: [{ role: 'user', content: 'b' }] });

    expect(groq.chat).toHaveBeenCalledTimes(2);
  });
});

describe('cost', () => {
  it('prices a call from the provider token counts and records it', async () => {
    const costs = fakeCosts();
    const { router } = routerWith([provider('groq')], { costs });

    const response = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'hi' }],
    });

    // 1000 input at $1/MTok plus 500 output at $2/MTok.
    expect(response.costUsd).toBeCloseTo(0.002, 6);
    expect(costs.record).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'match.semantic', providerId: 'groq' }),
    );
  });

  /**
   * A ceiling is a decision the deployment made. Falling through to the next
   * provider would spend money it just said it would not spend.
   */
  it('stops the whole call when the budget is exhausted, without trying anyone else', async () => {
    const costs = fakeCosts({
      assertWithinBudget: vi.fn(async () => {
        throw new BudgetExceededError('daily', 10, 10);
      }),
    });
    const gemini = provider('gemini');
    const { router } = routerWith([provider('groq'), gemini], { costs });

    await expect(
      router.chat('match.semantic', { messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(gemini.chat).not.toHaveBeenCalled();
  });
});

describe('rate limiting', () => {
  it('moves to the next provider when the local budget for one is spent', async () => {
    const limiter = { tryAcquire: vi.fn(async (key: string) => key !== 'groq') };
    const groq = provider('groq');
    const gemini = provider('gemini');
    const { router } = routerWith([groq, gemini], { limiter });

    const response = await router.chat('match.semantic', {
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(groq.chat).not.toHaveBeenCalled();
    expect(response.providerId).toBe('gemini');
  });
});

describe('structured output', () => {
  it('parses and validates a schema-constrained reply', async () => {
    const groq = provider('groq', {
      chat: vi.fn(async () => ({
        content: '{"score": 82, "verdict": "same"}',
        providerId: 'groq',
        model: 'groq-model',
      })),
    });
    const { router } = routerWith([groq]);

    const { value } = await router.chatStructured(
      'match.semantic',
      { messages: [{ role: 'user', content: 'compare' }] },
      VERDICT,
    );

    expect(value).toEqual({ score: 82, verdict: 'same' });
  });

  it('reads JSON out of a fenced or chatty reply', async () => {
    const groq = provider('groq', {
      chat: vi.fn(async () => ({
        content: 'Sure!\n```json\n{"score": 10, "verdict": "different"}\n```',
        providerId: 'groq',
        model: 'groq-model',
      })),
    });
    const { router } = routerWith([groq]);

    const { value } = await router.chatStructured(
      'match.semantic',
      { messages: [{ role: 'user', content: 'compare' }] },
      VERDICT,
    );

    expect(value.verdict).toBe('different');
  });

  it('asks once more when the reply does not match the schema', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: '{"score": "high"}', providerId: 'groq', model: 'm' })
      .mockResolvedValueOnce({
        content: '{"score": 91, "verdict": "same"}',
        providerId: 'groq',
        model: 'm',
      });
    const { router } = routerWith([provider('groq', { chat })]);

    const { value } = await router.chatStructured(
      'item.enhance',
      { messages: [{ role: 'user', content: 'compare' }] },
      VERDICT,
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(value.score).toBe(91);
  });

  it('gives up after the repair attempt rather than inventing a value', async () => {
    const { router } = routerWith([
      provider('groq', {
        chat: vi.fn(async () => ({ content: 'no idea', providerId: 'groq', model: 'm' })),
      }),
    ]);

    await expect(
      router.chatStructured(
        'item.enhance',
        { messages: [{ role: 'user', content: 'compare' }] },
        VERDICT,
      ),
    ).rejects.toThrow(/did not return a valid verdict/);
  });

  /**
   * A deployment with only Groq must not lose structured features because no
   * provider can constrain output. The instruction is weaker; the validation
   * afterwards is the same.
   */
  it('falls back to a provider that cannot constrain output when none can', async () => {
    const groq = provider('groq', {
      capabilities: { ...FULL, jsonSchema: false },
      chat: vi.fn(async () => ({
        content: '{"score": 55, "verdict": "same"}',
        providerId: 'groq',
        model: 'm',
      })),
    });
    const { router } = routerWith([groq]);

    const { value } = await router.chatStructured(
      'match.semantic',
      { messages: [{ role: 'user', content: 'compare' }] },
      VERDICT,
    );

    expect(value.score).toBe(55);
  });

  /**
   * The admin setting chooses the primary, and a schema request does not get
   * to overrule it. Every provider here but OpenAI and Anthropic asks for JSON
   * rather than constraining it, so filtering on the capability would quietly
   * send every structured call to the most expensive provider configured while
   * the admin screen still said "Primary: Groq".
   */
  it('does not demote the primary the admin chose for a schema request', async () => {
    const groq = provider('groq', {
      capabilities: { ...FULL, jsonSchema: false },
      chat: vi.fn(async () => ({
        content: '{"score": 70, "verdict": "same"}',
        providerId: 'groq',
        model: 'm',
      })),
    });
    const openai = provider('openai');
    const { router } = routerWith([groq, openai]);

    const { response } = await router.chatStructured(
      'match.semantic',
      { messages: [{ role: 'user', content: 'compare' }] },
      VERDICT,
    );

    expect(response.providerId).toBe('groq');
    expect(openai.chat).not.toHaveBeenCalled();
  });

  /** Among the fallbacks, though, the one that can constrain output goes first. */
  it('prefers a schema-capable fallback over one that only asks', async () => {
    const groq = provider('groq', {
      capabilities: { ...FULL, jsonSchema: false },
      chat: vi.fn(async () => {
        throw new ProviderError('groq', 'down', 503, false);
      }),
    });
    const grok = provider('grok', { capabilities: { ...FULL, jsonSchema: false } });
    const openai = provider('openai', {
      chat: vi.fn(async () => ({
        content: '{"score": 70, "verdict": "same"}',
        providerId: 'openai',
        model: 'm',
      })),
    });
    const { router } = routerWith([groq, grok, openai]);

    const { response } = await router.chatStructured(
      'match.semantic',
      { messages: [{ role: 'user', content: 'compare' }] },
      VERDICT,
    );

    expect(response.providerId).toBe('openai');
    expect(grok.chat).not.toHaveBeenCalled();
  });

  /**
   * A reply that fails validation must not stay in the cache. The repair asks
   * a different question and so writes under a different key, and without this
   * every later call for the rest of the TTL would hit the bad entry and pay
   * for the same repair again.
   */
  it('drops a cached reply that failed validation', async () => {
    const cache = fakeCache();
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: '{"score": "high"}', providerId: 'groq', model: 'm' })
      .mockResolvedValueOnce({
        content: '{"score": 91, "verdict": "same"}',
        providerId: 'groq',
        model: 'm',
      });
    const { router } = routerWith([provider('groq', { chat })], { cache });

    await router.chatStructured(
      'match.semantic',
      { messages: [{ role: 'user', content: 'compare' }] },
      VERDICT,
    );

    expect(cache.delete).toHaveBeenCalledTimes(1);
    expect([...cache.store.values()]).not.toContainEqual(
      expect.objectContaining({ content: '{"score": "high"}' }),
    );
  });
});
