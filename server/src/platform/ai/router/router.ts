/**
 * The router.
 *
 * Everything that used to be missing between a caller and a model lives here:
 * which providers can serve this request at all, in what order, how long each
 * attempt may take, what to retry, when to stop asking a provider that is
 * down, what a call cost, and whether the answer was already known.
 *
 * A caller names a task and passes messages. It does not name a provider, and
 * it cannot: that is what makes a provider swappable and a policy editable.
 */

import { TimeoutError, withTimeout } from '../../../utils/async.js';
import { createLogger } from '../../../utils/logger.js';
import { env } from '../../../config/env.js';
import {
  NoProviderAvailableError,
  ProviderError,
  StructuredOutputError,
  BudgetExceededError,
} from '../ai.errors.js';
import { extractJson, type StructuredSpec } from '../structured.js';
import { providerRegistry, ProviderRegistry, type ProviderId } from '../providers/registry.js';
import { CircuitBreaker } from './breaker.js';
import { cacheKey, ResponseCache } from './cache.js';
import { CostMeter, priceOf } from './cost.js';
import { policyFor, type AiTask, type TaskPolicy } from './policy.js';
import { RateLimiter } from './rate-limit.js';
import type { ChatProvider, ChatRequest, ChatResponse } from '../ports/chat.port.js';

const log = createLogger('ai:router');

/** What a caller asks for. Everything else comes from the task policy. */
export interface RouterRequest {
  messages: ChatRequest['messages'];
  images?: ChatRequest['images'];
  temperature?: number;
  maxTokens?: number;
  structured?: StructuredSpec<unknown>;
}

export interface RouterResponse extends ChatResponse {
  cached: boolean;
  costUsd: number;
  attempts: number;
  /** Where this reply is cached, so a caller that rejects it can drop it. */
  cacheKey?: string;
}

/**
 * What the circuit breaker trips on.
 *
 * The provider and the task, not the provider alone. Two tasks on one provider
 * fail for different reasons and at different sizes: a rerank sends twenty
 * candidates in one prompt against a 45-second ceiling, and a pair score sends
 * two lines against fifteen. A rerank that times out says nothing about
 * whether the provider can answer the small call, and a provider-wide key made
 * it say everything — the batch's failures opened the breaker, and the
 * per-pair scorer that was supposed to be the fallback ran straight into it
 * and returned nothing for every candidate.
 *
 * The cost is that a provider which is genuinely down is discovered once per
 * task rather than once. That is a handful of timeouts, and it buys a fallback
 * that actually falls back.
 */
function breakerKey(providerId: string, task: AiTask): string {
  return `${providerId}:${task}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/** Backoff with jitter, so a shared outage does not produce a synchronised retry. */
function backoffMs(attempt: number): number {
  const base = 250 * 2 ** (attempt - 1);

  return base + Math.floor(Math.random() * base);
}

export class AiRouter {
  constructor(
    private readonly registry: ProviderRegistry = providerRegistry,
    private readonly cache = new ResponseCache(),
    private readonly breaker = new CircuitBreaker(),
    private readonly limiter = new RateLimiter(env.ai.requestsPerMinute),
    private readonly costs = new CostMeter(),
  ) {}

  /**
   * Providers that could serve this request, in policy order.
   *
   * Vision is a hard filter: a text-only model handed an image returns a 400
   * that no amount of retrying fixes, so it is a routing mistake rather than a
   * failure. A schema is a preference, not a filter. Excluding providers that
   * cannot constrain output would silently demote the primary the admin chose,
   * because every provider here except OpenAI and Anthropic asks rather than
   * constrains. So the primary stays first, and schema-capable fallbacks are
   * tried ahead of the others.
   */
  private candidates(policy: TaskPolicy, request: RouterRequest): ChatProvider[] {
    const seen = new Set<ProviderId>();

    const usable = (id: ProviderId): ChatProvider | null => {
      if (seen.has(id)) return null;

      seen.add(id);

      const provider = this.registry.get(id);

      if (!provider) return null;
      if (request.images?.length && !provider.capabilities.vision) return null;

      return provider;
    };

    const primary = usable(policy.primary);
    const fallbacks = policy.fallbacks
      .map(usable)
      .filter((provider): provider is ChatProvider => provider !== null);

    if (request.structured) {
      fallbacks.sort(
        (a, b) => Number(b.capabilities.jsonSchema) - Number(a.capabilities.jsonSchema),
      );
    }

    return primary ? [primary, ...fallbacks] : fallbacks;
  }

  async chat(task: AiTask, request: RouterRequest): Promise<RouterResponse> {
    const policy = await policyFor(task);
    const providers = this.candidates(policy, request);

    if (providers.length === 0) {
      throw new NoProviderAvailableError(
        task,
        this.registry.available().length === 0
          ? 'no provider is configured'
          : 'no configured provider has the required capability',
      );
    }

    const chatRequest: ChatRequest = {
      messages: request.messages,
      images: request.images,
      temperature: request.temperature ?? policy.temperature,
      maxTokens: request.maxTokens ?? policy.maxTokens,
      structured: request.structured,
    };

    let lastError: unknown = null;
    let attempts = 0;
    // A per-attempt timeout is not a bound on the call: with a fallback list as
    // long as the registry, a task a user is waiting on could spend one timeout
    // per provider before it gave up.
    const deadline = Date.now() + policy.deadlineMs;

    for (const provider of providers) {
      const cached = await this.readCache(provider, chatRequest, policy);

      if (cached) {
        // A hit produces no provider call, so without this line the cache is
        // invisible: spend drops and nothing says why.
        log.info('AI call', {
          task,
          provider: provider.id,
          model: cached.model,
          cacheHit: true,
          costUsd: 0,
        });

        return {
          ...cached,
          cached: true,
          costUsd: 0,
          attempts,
          cacheKey: cacheKey(provider.id, provider.model, chatRequest),
        };
      }

      for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
        // Inside the loop: a failed attempt can open the circuit, and checking
        // once per provider would hand the remaining attempts to a provider
        // the breaker had already given up on.
        if (!this.breaker.allows(breakerKey(provider.id, task))) {
          log.debug('Skipping provider, circuit is open', { provider: provider.id, task });
          break;
        }

        if (Date.now() >= deadline) {
          log.warn('Deadline reached before an answer', { task, attempts });
          break;
        }

        attempts += 1;

        try {
          const response = await this.callOnce(task, provider, chatRequest, policy, attempt);

          return { ...response, cached: false, attempts };
        } catch (error) {
          lastError = error;

          // A ceiling is a decision, not a transport failure: trying the next
          // provider would spend money the deployment said it would not.
          if (error instanceof BudgetExceededError) throw error;

          const retryable = error instanceof ProviderError && error.retryable;

          if (!retryable || attempt >= policy.attempts) break;

          await delay(backoffMs(attempt));
        }
      }

      if (Date.now() >= deadline) break;
    }

    log.error('Every provider failed', { task, tried: providers.map((p) => p.id) });

    throw lastError instanceof Error
      ? lastError
      : new NoProviderAvailableError(task, 'every provider failed');
  }

  /**
   * A schema-constrained call, validated here rather than trusted.
   *
   * One repair attempt, because a model that returned the wrong shape usually
   * returns the right one when told what was wrong, and a second failure is a
   * prompt problem that retrying will not fix.
   */
  async chatStructured<T>(
    task: AiTask,
    request: RouterRequest,
    spec: StructuredSpec<T>,
  ): Promise<{ value: T; response: RouterResponse }> {
    const first = await this.chat(task, { ...request, structured: spec });
    const parsed = spec.schema.safeParse(extractJson(first.content));

    if (parsed.success) return { value: parsed.data, response: first };

    log.warn('Structured reply failed validation, asking once more', {
      task,
      provider: first.providerId,
      issue: parsed.error.issues[0]?.message,
    });

    // The repair asks a different question, so it caches under a different
    // key. Without this, the reply that just failed validation stays cached
    // for its whole TTL and every later call pays for the same repair.
    if (first.cacheKey) await this.cache.delete(first.cacheKey);

    const repair = await this.chat(task, {
      ...request,
      structured: spec,
      messages: [
        ...request.messages,
        { role: 'assistant', content: first.content.slice(0, 2000) },
        {
          role: 'user',
          content: `That did not match the required schema (${parsed.error.issues[0]?.message ?? 'invalid'}). Reply with the JSON object only.`,
        },
      ],
    });

    const second = spec.schema.safeParse(extractJson(repair.content));

    if (second.success) return { value: second.data, response: repair };

    throw new StructuredOutputError(
      repair.providerId,
      `${task} did not return a valid ${spec.name} after a repair attempt`,
    );
  }

  /** Providers with a key, for the admin screen and the availability check. */
  available(): ProviderId[] {
    return this.registry.available();
  }

  private async readCache(
    provider: ChatProvider,
    request: ChatRequest,
    policy: TaskPolicy,
  ): Promise<ChatResponse | null> {
    if (policy.cacheTtlSeconds <= 0) return null;

    return this.cache.get(cacheKey(provider.id, provider.model, request));
  }

  private async callOnce(
    task: AiTask,
    provider: ChatProvider,
    request: ChatRequest,
    policy: TaskPolicy,
    attempt: number,
  ): Promise<RouterResponse> {
    // Both guards can refuse before a call is made. The breaker may have
    // handed out a half-open probe to get here, and a probe that is taken and
    // never resolved leaves the provider probing for the life of the process.
    try {
      await this.costs.assertWithinBudget();

      const allowed = await this.limiter.tryAcquire(provider.id);

      if (!allowed) {
        // Not retryable: the window is fixed at a minute, so a quarter-second
        // backoff cannot clear it, and retrying only pushes the counter
        // further past the limit. The next provider is the useful move.
        throw new ProviderError(
          provider.id,
          `${provider.id} is over its local rate budget`,
          429,
          false,
        );
      }
    } catch (error) {
      this.breaker.releaseProbe(breakerKey(provider.id, task));

      throw error;
    }

    const controller = new AbortController();
    const startedAt = Date.now();

    try {
      const response = await withTimeout(
        provider.chat({ ...request, signal: controller.signal }),
        policy.timeoutMs,
        `${provider.id} ${task}`,
      );

      const costUsd = priceOf(response.usage, provider.cost);
      const key = cacheKey(provider.id, provider.model, request);

      this.breaker.recordSuccess(breakerKey(provider.id, task));

      log.info('AI call', {
        task,
        provider: provider.id,
        model: response.model,
        cacheHit: false,
        attempt,
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
        costUsd: Number(costUsd.toFixed(6)),
      });

      // Bookkeeping, not part of the answer. It runs after the try that
      // records a provider failure, because the provider has already answered
      // and been billed: a throw from a cache write must not open the breaker
      // and send the router off to buy the same answer again.
      await this.record(task, provider, response, costUsd, key, policy);

      return { ...response, cached: false, costUsd, attempts: attempt, cacheKey: key };
    } catch (error) {
      // A timeout abandons the promise; the abort is what stops the request in
      // flight. The tokens are already committed either way.
      controller.abort();

      this.breaker.recordFailure(breakerKey(provider.id, task));

      log.warn('AI call failed', {
        task,
        provider: provider.id,
        attempt,
        latencyMs: Date.now() - startedAt,
        error,
      });

      // A timeout is the transient failure the attempt budget was written for,
      // and it arrives as a `TimeoutError`, which carries no status and would
      // otherwise never be retried. 408 is what the provider would have said.
      throw error instanceof TimeoutError
        ? new ProviderError(provider.id, error.message, 408, true)
        : error;
    }
  }

  /** Cost and cache, both best effort, neither able to fail a paid-for call. */
  private async record(
    task: AiTask,
    provider: ChatProvider,
    response: ChatResponse,
    costUsd: number,
    key: string,
    policy: TaskPolicy,
  ): Promise<void> {
    try {
      await this.costs.record({
        task,
        providerId: provider.id,
        model: response.model,
        usage: response.usage,
        costUsd,
      });

      if (policy.cacheTtlSeconds > 0) {
        await this.cache.set(key, response, policy.cacheTtlSeconds);
      }
    } catch (error) {
      log.warn('Could not record an AI call', { task, provider: provider.id, error });
    }
  }
}

export const aiRouter = new AiRouter();
