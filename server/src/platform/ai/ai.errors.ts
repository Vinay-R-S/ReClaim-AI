/**
 * Failures the router has to tell apart.
 *
 * The distinction that matters is retryable against not: a 429 or a 503 is
 * worth another attempt and a 400 never is, and treating them the same is how
 * a bad prompt turns into three times the spend.
 */

export class ProviderError extends Error {
  constructor(
    readonly providerId: string,
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class NoProviderAvailableError extends Error {
  constructor(
    readonly task: string,
    readonly reason: string,
  ) {
    super(`No AI provider available for ${task}: ${reason}`);
    this.name = 'NoProviderAvailableError';
  }
}

export class BudgetExceededError extends Error {
  constructor(
    readonly window: 'daily' | 'monthly',
    readonly spentUsd: number,
    readonly ceilingUsd: number,
  ) {
    super(`AI ${window} budget exhausted: $${spentUsd.toFixed(2)} of $${ceilingUsd.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

export class StructuredOutputError extends Error {
  constructor(
    readonly providerId: string,
    message: string,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

/** HTTP statuses worth another attempt. Everything else is the caller's fault. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
