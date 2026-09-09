/**
 * What the models cost, and the ceiling that stops them.
 *
 * Every call is priced from the provider's own token counts and added to a
 * daily and a monthly document. The point is not accounting, it is the
 * ceiling: a matching loop that goes wrong, or a key that leaks, currently has
 * no upper bound at all except the provider's invoice.
 *
 * Recording is best effort and never fails a call that already happened.
 * Checking is cached for a minute, so the ceiling costs one Firestore read per
 * minute rather than one per call.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../../../utils/firebase-admin.js';
import { createLogger } from '../../../utils/logger.js';
import { env } from '../../../config/env.js';
import { BudgetExceededError } from '../ai.errors.js';
import type { ChatUsage, ProviderCost } from '../ports/chat.port.js';

const log = createLogger('ai:cost');

const TOTALS_CACHE_MS = 60_000;

export function priceOf(usage: ChatUsage | undefined, cost: ProviderCost): number {
  if (!usage) return 0;

  return (
    (usage.inputTokens / 1_000_000) * cost.inputPerMTok +
    (usage.outputTokens / 1_000_000) * cost.outputPerMTok
  );
}

export function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

interface CachedTotal {
  value: number;
  readAt: number;
}

export interface SpendRecord {
  task: string;
  providerId: string;
  model: string;
  usage?: ChatUsage;
  costUsd: number;
}

export class CostMeter {
  private readonly totals = new Map<string, CachedTotal>();

  /** One in-flight read per period, so a fan-out does not stampede Firestore. */
  private readonly reads = new Map<string, Promise<number>>();

  constructor(private readonly usage = collections.aiUsage) {}

  /**
   * Refuse the call when a ceiling is already spent.
   *
   * An unset ceiling means no ceiling, which is the current behaviour and the
   * default: turning one on is a deployment decision, not something a library
   * should assume.
   */
  async assertWithinBudget(now = new Date()): Promise<void> {
    const daily = env.ai.dailyBudgetUsd;
    const monthly = env.ai.monthlyBudgetUsd;

    if (daily > 0) {
      const spent = await this.spent(dayKey(now));

      if (spent >= daily) throw new BudgetExceededError('daily', spent, daily);
    }

    if (monthly > 0) {
      const spent = await this.spent(monthKey(now));

      if (spent >= monthly) throw new BudgetExceededError('monthly', spent, monthly);
    }
  }

  async record(entry: SpendRecord, now = new Date()): Promise<void> {
    // Nested objects, not dotted keys. `set` with `merge` treats a dotted key
    // as one field name containing dots, so `byProvider.groq.costUsd` would be
    // a flat field rather than the map the spend screen reads.
    const increments = {
      costUsd: FieldValue.increment(entry.costUsd),
      calls: FieldValue.increment(1),
      inputTokens: FieldValue.increment(entry.usage?.inputTokens ?? 0),
      outputTokens: FieldValue.increment(entry.usage?.outputTokens ?? 0),
      byProvider: {
        [entry.providerId]: {
          costUsd: FieldValue.increment(entry.costUsd),
          calls: FieldValue.increment(1),
        },
      },
      // A dot in a task name would nest one level deeper than intended.
      byTask: {
        [entry.task.replace(/\./g, '_')]: {
          costUsd: FieldValue.increment(entry.costUsd),
          calls: FieldValue.increment(1),
        },
      },
      updatedAt: FieldValue.serverTimestamp(),
    };

    const day = dayKey(now);
    const month = monthKey(now);

    // Before the write, not after it. The cached total is the only brake
    // between two reads, and bumping it only on success means it stops moving
    // in exactly the situation where it is all that is left.
    this.bump(day, entry.costUsd);
    this.bump(month, entry.costUsd);

    try {
      await Promise.all([
        this.usage.doc(day).set(increments, { merge: true }),
        this.usage.doc(month).set(increments, { merge: true }),
      ]);
    } catch (error) {
      // The money is already spent; losing the record must not lose the reply.
      log.warn('Could not record AI spend', { provider: entry.providerId, error });
    }
  }

  /**
   * Spend against a period document, cached for a minute.
   *
   * One read per period at a time: a fan-out of scorers on a cold cache would
   * otherwise issue one Firestore read each, and every one of them would read
   * the same pre-burst total and pass a ceiling only the first should have.
   */
  private async spent(key: string, now = Date.now()): Promise<number> {
    const cached = this.totals.get(key);

    if (cached && now - cached.readAt < TOTALS_CACHE_MS) return cached.value;

    const existing = this.reads.get(key);

    if (existing) return existing;

    const read = this.readSpend(key, now).finally(() => {
      this.reads.delete(key);
    });

    this.reads.set(key, read);

    return read;
  }

  private async readSpend(key: string, now: number): Promise<number> {
    try {
      const snapshot = await this.usage.doc(key).get();
      const value = snapshot.exists ? Number(snapshot.data()?.costUsd ?? 0) : 0;

      this.totals.set(key, { value, readAt: now });

      return value;
    } catch (error) {
      // The last known total, not zero. Returning zero turns a Firestore blip
      // into a ceiling that silently switches itself off and stays off, since
      // nothing is cached and every following call repeats the failing read.
      const last = this.totals.get(key);

      log.warn('Could not read AI spend, using the last known total', {
        key,
        knownTotal: last?.value ?? 0,
        error,
      });

      return last?.value ?? 0;
    }
  }

  /** Keep the cached total moving between reads so a burst cannot outrun it. */
  private bump(key: string, amount: number): void {
    const cached = this.totals.get(key);

    if (cached) cached.value += amount;
  }

  reset(): void {
    this.totals.clear();
  }
}
