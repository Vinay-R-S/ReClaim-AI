/**
 * The circuit breaker.
 *
 * Its whole value is in the transitions, and each of them is a decision that
 * costs something if it is wrong: opening too eagerly takes a working provider
 * out, probing too eagerly sends the whole queue at one that is still down.
 */

import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './breaker.js';

const OPTIONS = { threshold: 2, cooldownMs: 1_000 };

describe('CircuitBreaker', () => {
  it('starts closed and allows calls', () => {
    const breaker = new CircuitBreaker(OPTIONS);

    expect(breaker.state('groq')).toBe('closed');
    expect(breaker.allows('groq')).toBe(true);
  });

  it('stays closed until the failures reach the threshold', () => {
    const breaker = new CircuitBreaker(OPTIONS);

    breaker.recordFailure('groq');

    expect(breaker.state('groq')).toBe('closed');

    breaker.recordFailure('groq');

    expect(breaker.state('groq')).toBe('open');
    expect(breaker.allows('groq')).toBe(false);
  });

  it('forgets the failures after a success', () => {
    const breaker = new CircuitBreaker(OPTIONS);

    breaker.recordFailure('groq');
    breaker.recordSuccess('groq');
    breaker.recordFailure('groq');

    expect(breaker.state('groq')).toBe('closed');
  });

  it('half-opens once the cooldown has passed', () => {
    const breaker = new CircuitBreaker(OPTIONS);
    const start = 1_000_000;

    breaker.recordFailure('groq', start);
    breaker.recordFailure('groq', start);

    expect(breaker.state('groq', start + 500)).toBe('open');
    expect(breaker.state('groq', start + 1_100)).toBe('half-open');
  });

  /** One probe, not a thundering herd at a provider that may still be down. */
  it('lets exactly one call through while half-open', () => {
    const breaker = new CircuitBreaker(OPTIONS);
    const start = 1_000_000;

    breaker.recordFailure('groq', start);
    breaker.recordFailure('groq', start);

    expect(breaker.allows('groq', start + 1_100)).toBe(true);
    expect(breaker.allows('groq', start + 1_100)).toBe(false);
  });

  it('re-opens the window when the probe fails', () => {
    const breaker = new CircuitBreaker(OPTIONS);
    const start = 1_000_000;

    breaker.recordFailure('groq', start);
    breaker.recordFailure('groq', start);
    breaker.allows('groq', start + 1_100);
    breaker.recordFailure('groq', start + 1_200);

    expect(breaker.state('groq', start + 1_300)).toBe('open');
  });

  it('closes again when the probe succeeds', () => {
    const breaker = new CircuitBreaker(OPTIONS);
    const start = 1_000_000;

    breaker.recordFailure('groq', start);
    breaker.recordFailure('groq', start);
    breaker.allows('groq', start + 1_100);
    breaker.recordSuccess('groq');

    expect(breaker.state('groq', start + 1_200)).toBe('closed');
  });

  it('keeps providers apart', () => {
    const breaker = new CircuitBreaker(OPTIONS);

    breaker.recordFailure('groq');
    breaker.recordFailure('groq');

    expect(breaker.state('groq')).toBe('open');
    expect(breaker.state('gemini')).toBe('closed');
  });
});
