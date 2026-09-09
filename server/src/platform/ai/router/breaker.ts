/**
 * Circuit breaker, one per provider.
 *
 * The failure this exists for: a provider that is down still accepts the
 * connection and holds it until the timeout, so every request pays fifteen
 * seconds to learn what the last one already knew. After a few consecutive
 * failures the breaker opens and the router skips straight to the next
 * provider; one probe after the cooldown decides whether it is back.
 *
 * State is per process. Two API instances discover an outage separately, which
 * costs one timeout each and needs no coordination.
 */

import { createLogger } from '../../../utils/logger.js';

const log = createLogger('ai:breaker');

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Consecutive failures before the breaker opens. */
  threshold: number;
  /** How long it stays open before a probe is allowed. */
  cooldownMs: number;
}

export const DEFAULT_BREAKER_OPTIONS: BreakerOptions = {
  threshold: 3,
  cooldownMs: 30_000,
};

interface Entry {
  failures: number;
  openedAt: number | null;
  probing: boolean;
}

export class CircuitBreaker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: BreakerOptions = DEFAULT_BREAKER_OPTIONS) {}

  state(key: string, now = Date.now()): BreakerState {
    const entry = this.entries.get(key);

    if (!entry?.openedAt) return 'closed';

    return now - entry.openedAt >= this.options.cooldownMs ? 'half-open' : 'open';
  }

  /**
   * Whether a call may go out.
   *
   * Half-open lets exactly one call through: a provider recovering from an
   * outage does not need the whole queue arriving at once to decide.
   */
  allows(key: string, now = Date.now()): boolean {
    const state = this.state(key, now);

    if (state === 'closed') return true;
    if (state === 'open') return false;

    const entry = this.entry(key);

    if (entry.probing) return false;

    entry.probing = true;

    return true;
  }

  /**
   * Hand a probe token back unused.
   *
   * `allows` marks a provider as being probed, and only a recorded success or
   * failure clears that. A caller that takes the token and then never makes
   * the call (a spent budget, an exhausted rate window) would otherwise leave
   * the provider probing forever: `state` stays half-open, `allows` returns
   * false to everyone after it, and the provider is dead for the life of the
   * process even after it recovers.
   */
  releaseProbe(key: string): void {
    const entry = this.entries.get(key);

    if (entry) entry.probing = false;
  }

  recordSuccess(key: string): void {
    const entry = this.entries.get(key);

    if (!entry) return;

    if (entry.openedAt) log.info('Provider recovered', { provider: key });

    this.entries.delete(key);
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.entry(key);

    entry.failures += 1;
    entry.probing = false;

    if (entry.failures >= this.options.threshold && !entry.openedAt) {
      entry.openedAt = now;
      log.warn('Provider circuit opened', { provider: key, failures: entry.failures });

      return;
    }

    // A failed probe re-opens the window rather than retrying immediately.
    if (entry.openedAt) entry.openedAt = now;
  }

  /** Test seam, and what a future admin panel would call. */
  reset(key?: string): void {
    if (key) {
      this.entries.delete(key);

      return;
    }

    this.entries.clear();
  }

  private entry(key: string): Entry {
    const existing = this.entries.get(key);

    if (existing) return existing;

    const created: Entry = { failures: 0, openedAt: null, probing: false };
    this.entries.set(key, created);

    return created;
  }
}
