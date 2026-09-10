/**
 * The admin setting, turned into an order of providers.
 *
 * The setting is the one piece of AI configuration a person can change today,
 * so what it means has to survive the move to a registry: `_only` still means
 * only, and `_with_fallback` now means every other provider rather than the
 * single hardcoded partner it used to.
 */

import { describe, expect, it } from 'vitest';
import { orderFor } from './policy.js';
import { DEFAULT_POLICIES, AI_TASKS } from './policy.js';

describe('orderFor', () => {
  it.each([
    ['groq_only', 'groq'],
    ['gemini_only', 'gemini'],
    ['grok_only', 'grok'],
  ] as const)('makes %s use %s alone', (setting, provider) => {
    expect(orderFor(setting)).toEqual({ primary: provider, fallbacks: [] });
  });

  it('puts every other provider behind the primary when fallback is on', () => {
    const { primary, fallbacks } = orderFor('groq_with_fallback');

    expect(primary).toBe('groq');
    expect(fallbacks).not.toContain('groq');
    expect(fallbacks).toContain('gemini');
    expect(fallbacks).toContain('anthropic');
  });

  it('orders the fallbacks cheapest first, with the local runtime last', () => {
    const { fallbacks } = orderFor('groq_with_fallback');

    expect(fallbacks.indexOf('gemini')).toBeLessThan(fallbacks.indexOf('anthropic'));
    expect(fallbacks[fallbacks.length - 1]).toBe('local');
  });

  it('falls back to groq for a setting that names nothing known', () => {
    expect(orderFor('nonsense_only' as never).primary).toBe('groq');
  });
});

describe('DEFAULT_POLICIES', () => {
  it('covers every task', () => {
    AI_TASKS.forEach((task) => {
      expect(DEFAULT_POLICIES[task]).toBeDefined();
    });
  });

  /**
   * No task caches, and each one has its own reason.
   *
   * The per-pair semantic scorer was the one that did, because the same two
   * items were re-scored on every matching run. It was retired with the
   * LLM-per-candidate path, and nothing that replaced it recurs: a rerank
   * batch is a set of candidates for one subject at one moment, an agent step
   * carries the transcript of the steps before it, and everything else is a
   * one-off a user is waiting on, where a cache would only serve a stale reply.
   *
   * The router keeps the capability. This says nothing currently asks for it,
   * so a TTL appearing on a task is a decision somebody made rather than one
   * that arrived with a copied policy block.
   */
  it('asks for no caching, because nothing left recurs', () => {
    AI_TASKS.forEach((task) => {
      expect(DEFAULT_POLICIES[task].cacheTtlSeconds).toBe(0);
    });
  });

  /**
   * The deadline is the bound on the whole call, so it has to be able to hold
   * the attempts the same policy asks for. `match.rerank` shipped for one round
   * with a 40 second deadline and two 30 second attempts, which is a documented
   * ceiling the code could exceed by half again.
   */
  it('gives every task a deadline its own attempts can fit inside', () => {
    AI_TASKS.forEach((task) => {
      const policy = DEFAULT_POLICIES[task];

      expect(policy.deadlineMs).toBeGreaterThanOrEqual(policy.timeoutMs * policy.attempts);
    });
  });

  it('bounds every attempt', () => {
    AI_TASKS.forEach((task) => {
      expect(DEFAULT_POLICIES[task].timeoutMs).toBeGreaterThan(0);
      expect(DEFAULT_POLICIES[task].attempts).toBeGreaterThan(0);
    });
  });
});
