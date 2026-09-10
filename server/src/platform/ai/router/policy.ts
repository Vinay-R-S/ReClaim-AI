/**
 * Per-task routing policy.
 *
 * The old model was one `aiProvider` string for the whole application, so a
 * choice made for image analysis also decided how a match was scored. A task
 * is the unit that actually has requirements: scoring a pair is cheap, high
 * volume and cacheable, describing a photo needs vision, and adjudication will
 * want the strongest model available.
 *
 * The admin setting still decides the order of providers, because that is what
 * it means today; what a task owns is everything else. The editable per-task
 * policy is phase 32's admin work.
 */

import { singleFlight } from '../../../utils/async.js';
import { settingsRepository } from '../../../repositories/settings.repository.js';
import { createLogger } from '../../../utils/logger.js';
import { PROVIDER_IDS, type ProviderId } from '../providers/registry.js';

const log = createLogger('ai:policy');

export const AI_TASKS = [
  'item.analyze',
  'item.enhance',
  'match.rerank',
  'match.adjudicate',
  'cctv.describe',
  'cctv.verify',
] as const;

export type AiTask = (typeof AI_TASKS)[number];

export interface TaskPolicy {
  primary: ProviderId;
  fallbacks: ProviderId[];
  temperature: number;
  maxTokens: number;
  /** Ceiling on one provider attempt, not on the whole call. */
  timeoutMs: number;
  /**
   * Ceiling on the whole call, across every provider and attempt.
   *
   * `timeoutMs` alone bounds nothing useful once a fallback list is as long as
   * the registry: six providers at fifteen seconds each is a minute and a half
   * on a form the user is watching.
   */
  deadlineMs: number;
  /** Zero disables caching for the task. */
  cacheTtlSeconds: number;
  /** Attempts against one provider, on a retryable failure, before the next. */
  attempts: number;
}

/**
 * The order a provider is tried in when the admin setting does not say.
 * Cheapest capable provider first; the local runtime last, because it is the
 * one most likely to be absent.
 */
const DEFAULT_ORDER: ProviderId[] = ['groq', 'gemini', 'openai', 'anthropic', 'grok', 'local'];

/**
 * Timeouts and token budgets are the values the previous implementation used,
 * so behaviour is unchanged where the phase is not deliberately changing it.
 * Cache TTLs and deadlines are new. A pair score is stable for an hour; an
 * image analysis is a one-off the user is watching, so it is not cached at
 * all. Deadlines are tighter for the two tasks a request blocks on than for
 * the ones that run in a worker.
 */
export const DEFAULT_POLICIES: Record<AiTask, TaskPolicy> = {
  'item.analyze': {
    primary: 'groq',
    fallbacks: [],
    temperature: 0.3,
    maxTokens: 1024,
    timeoutMs: 15_000,
    deadlineMs: 35_000,
    cacheTtlSeconds: 0,
    attempts: 1,
  },
  'item.enhance': {
    primary: 'groq',
    fallbacks: [],
    temperature: 0.3,
    maxTokens: 512,
    timeoutMs: 15_000,
    deadlineMs: 35_000,
    cacheTtlSeconds: 0,
    attempts: 1,
  },
  /**
   * One call for a whole batch, so it is allowed to be slower and larger than
   * the per-pair scorer it replaces and still cost less overall.
   *
   * Not cached. The key would be the whole batch, and a batch is a set of
   * candidates for one subject at one moment: the same batch essentially never
   * recurs, so a cache would store entries nothing ever reads.
   *
   * Tightened when the per-pair scorer was retired. This is now the only
   * semantic scorer, so it sits in front of every match the system makes,
   * inside a `match.item` attempt killed at two minutes that it shares with
   * retrieval, the visual scorer and adjudication. The reranker bounds itself
   * across batches as well; this bounds one of them.
   */
  'match.rerank': {
    primary: 'groq',
    fallbacks: [],
    temperature: 0.1,
    maxTokens: 4096,
    timeoutMs: 20_000,
    deadlineMs: 45_000,
    cacheTtlSeconds: 0,
    attempts: 2,
  },
  /**
   * One step of an agent run, not a whole one.
   *
   * The agent makes several of these in sequence, so the per-step budget is
   * small and the bound that matters is the run deadline in
   * `ADJUDICATION_DEADLINE_MS`, which the agent enforces itself across every
   * step and tool call. Uncached, because a step's prompt carries the
   * transcript of the steps before it and therefore never recurs.
   *
   * `attempts` is 1 on purpose. A retried step is a step whose partial work
   * may already be in the transcript, and the run's own deadline is the better
   * place to spend the time.
   */
  'match.adjudicate': {
    primary: 'groq',
    fallbacks: [],
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: 12_000,
    deadlineMs: 15_000,
    cacheTtlSeconds: 0,
    attempts: 1,
  },
  'cctv.describe': {
    primary: 'groq',
    fallbacks: [],
    temperature: 0.3,
    maxTokens: 512,
    timeoutMs: 15_000,
    deadlineMs: 35_000,
    cacheTtlSeconds: 0,
    attempts: 1,
  },
  'cctv.verify': {
    primary: 'groq',
    fallbacks: [],
    temperature: 0.3,
    maxTokens: 512,
    timeoutMs: 15_000,
    deadlineMs: 35_000,
    cacheTtlSeconds: 0,
    attempts: 1,
  },
};

/** The stored settings values, unchanged from before this phase. */
export type LegacyProviderSetting =
  | 'groq_only'
  | 'gemini_only'
  | 'grok_only'
  | 'groq_with_fallback'
  | 'gemini_with_fallback'
  | 'grok_with_fallback';

const SETTINGS_CACHE_TTL_MS = 60_000;

let cachedSetting: LegacyProviderSetting | null = null;
let cachedAt = 0;

/**
 * Read the admin setting.
 *
 * `singleFlight` because a fan-out of scorers on a cold cache would otherwise
 * issue one Firestore read per candidate, which is the defect phase 8 fixed
 * and this must not reintroduce.
 */
const fetchSetting = singleFlight(async (): Promise<LegacyProviderSetting> => {
  try {
    const settings = await settingsRepository.getSystem();
    const value = (settings?.aiProvider as LegacyProviderSetting) || 'groq_only';

    cachedSetting = value;
    cachedAt = Date.now();

    return value;
  } catch (error) {
    log.warn('Could not read the AI provider setting, using the default', { error });

    return 'groq_only';
  }
});

export async function currentProviderSetting(): Promise<LegacyProviderSetting> {
  if (cachedSetting && Date.now() - cachedAt < SETTINGS_CACHE_TTL_MS) return cachedSetting;

  return fetchSetting();
}

export function resetPolicyCache(): void {
  cachedSetting = null;
  cachedAt = 0;
}

/**
 * Turn the stored setting into an order of providers.
 *
 * `*_only` means exactly that and keeps its empty fallback list, which is the
 * behaviour an admin chose. `*_with_fallback` used to mean one hardcoded
 * partner; it now means every other configured provider, cheapest first, which
 * is the whole point of having a registry.
 */
export function orderFor(setting: LegacyProviderSetting): {
  primary: ProviderId;
  fallbacks: ProviderId[];
} {
  const primary = setting.split('_')[0] as ProviderId;
  const resolved: ProviderId = PROVIDER_IDS.includes(primary) ? primary : 'groq';

  if (!setting.endsWith('with_fallback')) return { primary: resolved, fallbacks: [] };

  return { primary: resolved, fallbacks: DEFAULT_ORDER.filter((id) => id !== resolved) };
}

export async function policyFor(task: AiTask): Promise<TaskPolicy> {
  const base = DEFAULT_POLICIES[task];
  const { primary, fallbacks } = orderFor(await currentProviderSetting());

  return { ...base, primary, fallbacks };
}
