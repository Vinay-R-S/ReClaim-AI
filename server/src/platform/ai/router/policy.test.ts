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
   * A pair score is asked for over and over as an item stays Pending, and the
   * answer for an unchanged pair does not change. Anything a user is waiting
   * on is a one-off and caching it would only serve them a stale reply.
   */
  it('caches pair scoring and nothing a user is waiting on', () => {
    expect(DEFAULT_POLICIES['match.semantic'].cacheTtlSeconds).toBeGreaterThan(0);
    expect(DEFAULT_POLICIES['item.analyze'].cacheTtlSeconds).toBe(0);
    expect(DEFAULT_POLICIES['item.enhance'].cacheTtlSeconds).toBe(0);
  });

  it('bounds every attempt', () => {
    AI_TASKS.forEach((task) => {
      expect(DEFAULT_POLICIES[task].timeoutMs).toBeGreaterThan(0);
      expect(DEFAULT_POLICIES[task].attempts).toBeGreaterThan(0);
    });
  });
});
