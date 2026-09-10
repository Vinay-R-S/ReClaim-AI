/**
 * Typed, validated environment configuration.
 *
 * Every environment variable the server reads is declared here, parsed once at
 * import time, and exposed through the frozen `env` object. Nothing else in
 * `src/` may read `process.env` (the logger is the single exception, because it
 * must work before this module has parsed).
 *
 * Boot fails loudly, but only for configuration the server cannot work around:
 * in production, a missing Firebase credential or a localhost `CLIENT_URL`
 * makes importing this module throw `EnvValidationError` listing every problem
 * at once. Everything else (Cloudinary, LLM keys, email transport, blockchain)
 * already guards itself at runtime and degrades, so it is surfaced through
 * `warnings` and logged at boot rather than aborting a running deployment.
 */

import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .min(1)
  .optional()
  .catch(undefined)
  .transform((value) => (value === '' ? undefined : value));

/**
 * A variable that is present but empty is the same as absent. Without this,
 * `CLIENT_URL=` in a `.env` file fails validation before `.default()` can
 * apply, which would turn a benign config state into a boot failure.
 */
function withDefault<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, schema);
}

const lowercased = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().toLowerCase();
    return trimmed === '' ? undefined : trimmed;
  }, schema);

/**
 * A malformed queue URL is treated as unset rather than as a boot failure, the
 * same way every other degradable dependency in this file is, but it gets a
 * warning of its own so the two states cannot be confused.
 */
function isRedisUrl(value: string): boolean {
  return value.startsWith('redis://') || value.startsWith('rediss://');
}

/** Anything shorter is not worth calling a key, so it counts as unset. */
const MIN_HANDOVER_SECRET_LENGTH = 32;

/**
 * Only ever used outside production. It keeps codes issued before a restart
 * verifiable on a developer machine; production boot fails without a real key.
 */
const DEVELOPMENT_HANDOVER_SECRET = 'reclaim-development-handover-code-secret';

/**
 * A flag, parsed the same way everywhere.
 *
 * `value !== 'false'` and `value === 'true'` are opposite halves of the same
 * mistake: one turns `0`, `no` and `off` into true, the other turns `1`, `yes`
 * and `on` into false. An operator who wrote either into an air-gapped
 * deployment would get the setting they did not ask for and no complaint, so
 * anything outside the accepted set is a startup error rather than a guess.
 */
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

function booleanWithDefault(fallback: boolean) {
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return fallback;

      const normalised = value.trim().toLowerCase();

      if (TRUE_VALUES.has(normalised)) return true;
      if (FALSE_VALUES.has(normalised)) return false;

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expected one of true/false/1/0/yes/no/on/off, got "${value}"`,
      });

      return z.NEVER;
    });
}

const rawSchema = z.object({
  NODE_ENV: lowercased(z.enum(['development', 'test', 'production']).default('development')),
  PORT: withDefault(z.coerce.number().int().positive().max(65535).default(3001)),
  LOG_LEVEL: lowercased(z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional()),
  CLIENT_URL: withDefault(z.string().url().default('http://localhost:5173')),

  FIREBASE_SERVICE_ACCOUNT_KEY: optionalString,
  FIREBASE_PROJECT_ID: withDefault(z.string().min(1).default('reclaim-ai-bc273')),

  HANDOVER_CODE_SECRET: optionalString,

  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,

  GROQ_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  GROK_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,

  // Model identifiers move faster than deployments do, so each is overridable
  // without a release. The defaults live in the provider registry.
  GROQ_MODEL: optionalString,
  GEMINI_MODEL: optionalString,
  GROK_MODEL: optionalString,
  OPENAI_MODEL: optionalString,
  ANTHROPIC_MODEL: optionalString,

  /** An OpenAI-compatible endpoint on this machine, such as Ollama. */
  LOCAL_LLM_URL: optionalString,
  LOCAL_LLM_MODEL: optionalString,

  // Zero means no ceiling, which is the behaviour before this phase.
  AI_DAILY_BUDGET_USD: withDefault(z.coerce.number().min(0).default(0)),
  AI_MONTHLY_BUDGET_USD: withDefault(z.coerce.number().min(0).default(0)),
  AI_REQUESTS_PER_MINUTE: withDefault(z.coerce.number().int().min(0).max(10_000).default(120)),

  CLARIFAI_API_KEY: optionalString,
  CLARIFAI_PAT: optionalString,
  CLARIFAI_USER_ID: withDefault(z.string().min(1).default('clarifai')),
  CLARIFAI_APP_ID: withDefault(z.string().min(1).default('main')),
  CLARIFAI_MODEL_ID: withDefault(z.string().min(1).default('general-image-recognition')),

  RESEND_API_KEY: optionalString,
  FROM_EMAIL: optionalString,
  SMTP_HOST: withDefault(z.string().min(1).default('smtp.gmail.com')),
  SMTP_PORT: withDefault(z.coerce.number().int().positive().max(65535).default(587)),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,

  REDIS_URL: optionalString,
  QUEUE_CONCURRENCY: withDefault(z.coerce.number().int().positive().max(64).default(4)),
  OUTBOX_POLL_INTERVAL_MS: withDefault(z.coerce.number().int().min(200).max(60_000).default(2_000)),
  OUTBOX_BATCH_SIZE: withDefault(z.coerce.number().int().positive().max(200).default(20)),

  // Embeddings run in this process on CPU (ADR 0004). Every value has a
  // working default, so the feature needs no configuration to work and every
  // knob exists for a deployment that has measured something.
  EMBEDDINGS_ENABLED: booleanWithDefault(true),
  EMBEDDING_MODEL: withDefault(z.string().min(1).default('Xenova/bge-small-en-v1.5')),
  EMBEDDING_MODEL_REVISION: withDefault(z.string().min(1).default('main')),
  // 2048 is Firestore's ceiling for an indexed vector field, and an index is
  // what makes the vector searchable rather than merely stored.
  EMBEDDING_DIMENSIONS: withDefault(z.coerce.number().int().positive().max(2048).default(384)),
  EMBEDDING_IMAGE_MODEL: withDefault(z.string().min(1).default('Xenova/clip-vit-base-patch32')),
  EMBEDDING_IMAGE_MODEL_REVISION: withDefault(z.string().min(1).default('main')),
  EMBEDDING_IMAGE_DIMENSIONS: withDefault(
    z.coerce.number().int().positive().max(2048).default(512),
  ),
  /** Where model files are cached. Outside node_modules, which a reinstall wipes. */
  MODEL_CACHE_DIR: withDefault(z.string().min(1).default('./.models')),
  EMBEDDING_BATCH_SIZE: withDefault(z.coerce.number().int().positive().max(256).default(16)),
  /** Pinned rather than left at the core count. See platform/embeddings/runtime.ts. */
  EMBEDDING_THREADS: withDefault(z.coerce.number().int().positive().max(64).default(1)),
  /** True refuses the network, so a cold cache fails loudly instead of downloading. */
  EMBEDDINGS_OFFLINE: booleanWithDefault(false),

  /**
   * Hybrid retrieval (ADR 0003): off, measured against the current retrieval,
   * or actually used. `shadow` is the default, so the phase ships measuring
   * itself and changes no behaviour until somebody has read the numbers.
   */
  RETRIEVAL_MODE: withDefault(z.enum(['off', 'shadow', 'on']).default('shadow')),
  /** How many candidates retrieval hands the scorers when the mode is `on`. */
  RETRIEVAL_LIMIT: withDefault(z.coerce.number().int().positive().max(500).default(50)),

  /**
   * Candidates per rerank call. One huge prompt reasons worse, and fails bigger.
   *
   * `RERANK_MODE` used to sit here. Batched reranking is no longer a mode: it
   * is the semantic scorer, the per-pair scorer it was measured against has
   * been retired, and a flag whose only other setting is "score nothing" is
   * not a flag. A deployment that still sets it is warned at boot.
   */
  RERANK_BATCH_SIZE: withDefault(z.coerce.number().int().positive().max(100).default(20)),

  /**
   * The adjudication agent (section 8.6): off, run and recorded but not acted
   * on, or allowed to decide. `shadow` is the default for the same reason the
   * two stages before it default to it, and here the reason is sharper: this
   * is the only stage that can turn a pair the pipeline called a match into
   * one it does not.
   */
  ADJUDICATION_MODE: withDefault(z.enum(['off', 'shadow', 'on']).default('shadow')),
  /**
   * The uncertainty band, as a normalised pipeline score.
   *
   * Above the top of it a pair is certain enough to confirm without paying for
   * an agent run; below the bottom it is not worth one. Only what falls
   * between is adjudicated, which is what keeps the expensive stage rare.
   */
  ADJUDICATION_BAND_LOW: withDefault(z.coerce.number().int().min(0).max(100).default(60)),
  ADJUDICATION_BAND_HIGH: withDefault(z.coerce.number().int().min(0).max(100).default(85)),
  /** Tool calls one run may make before it is stopped and reports what it has. */
  ADJUDICATION_MAX_TOOL_CALLS: withDefault(z.coerce.number().int().positive().max(30).default(8)),
  /**
   * Wall clock for a whole run, across every model call and tool call.
   *
   * The default is chosen against the budget above it, not in isolation. This
   * stage is awaited inside a `match.item` attempt killed at 120 seconds, and
   * retrieval, scoring and rerank have already spent most of that, so a
   * generous number here buys a verdict at the price of the matching run it
   * was meant to improve.
   */
  ADJUDICATION_DEADLINE_MS: withDefault(
    z.coerce.number().int().positive().max(300_000).default(20_000),
  ),
  /**
   * How sure the agent must be before its verdict is allowed to move a pair.
   *
   * Applies in `on` mode only, and to both directions: a confirmation and a
   * rejection are both decisions, and a decision made at 30 percent confidence
   * is one the deterministic score should have kept.
   */
  ADJUDICATION_MIN_CONFIDENCE: withDefault(z.coerce.number().int().min(0).max(100).default(70)),

  YOLO_SERVICE_URL: withDefault(z.string().url().default('http://localhost:5000')),
  YOLO_SERVICE_TOKEN: optionalString,

  BLOCKCHAIN_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  SEPOLIA_RPC_URL: optionalString,
  CONTRACT_ADDRESS: optionalString,
  ADMIN_PRIVATE_KEY: optionalString,
});

type RawEnv = z.infer<typeof rawSchema>;

export class EnvValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvValidationError';
    this.problems = problems;
  }
}

export interface AppEnv {
  nodeEnv: RawEnv['NODE_ENV'];
  isProduction: boolean;
  isTest: boolean;
  port: number;
  /** Declared for completeness; the logger reads `LOG_LEVEL` itself, see logger.ts. */
  logLevel?: RawEnv['LOG_LEVEL'];
  clientUrl: string;
  firebase: {
    serviceAccountKey?: string;
    projectId: string;
  };
  handover: {
    /** HMAC key for handover code hashes. Never logged, never sent anywhere. */
    codeSecret: string;
    isConfigured: boolean;
  };
  cloudinary: {
    cloudName?: string;
    apiKey?: string;
    apiSecret?: string;
    isConfigured: boolean;
  };
  llm: {
    groqApiKey?: string;
    geminiApiKey?: string;
    grokApiKey?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    groqModel?: string;
    geminiModel?: string;
    grokModel?: string;
    openaiModel?: string;
    anthropicModel?: string;
    /** Set means a local runtime is available as a provider. */
    localUrl?: string;
    localModel?: string;
  };
  ai: {
    /** Zero means no ceiling. */
    dailyBudgetUsd: number;
    monthlyBudgetUsd: number;
    /** Per provider, per minute, across every process when Redis is configured. */
    requestsPerMinute: number;
  };
  clarifai: {
    apiKey?: string;
    pat?: string;
    userId: string;
    appId: string;
    modelId: string;
  };
  email: {
    resendApiKey?: string;
    fromEmail?: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser?: string;
    smtpPass?: string;
  };
  queue: {
    /** Unset means the in-process driver: jobs still run, nothing survives a restart. */
    redisUrl?: string;
    isConfigured: boolean;
    concurrency: number;
    outboxPollIntervalMs: number;
    outboxBatchSize: number;
  };
  matching: {
    /** See RETRIEVAL_MODE. `shadow` measures without changing what is scored. */
    retrievalMode: 'off' | 'shadow' | 'on';
    retrievalLimit: number;
    rerankBatchSize: number;
    /** See ADJUDICATION_MODE. `shadow` records a verdict and acts on none. */
    adjudicationMode: 'off' | 'shadow' | 'on';
    /** The score band a pair must fall in to be worth an agent run. */
    adjudicationBandLow: number;
    adjudicationBandHigh: number;
    adjudicationMaxToolCalls: number;
    adjudicationDeadlineMs: number;
    adjudicationMinConfidence: number;
  };
  embeddings: {
    /** False turns the feature off entirely; nothing is computed and nothing is stored. */
    enabled: boolean;
    textModel: string;
    textModelRevision: string;
    textDimensions: number;
    imageModel: string;
    imageModelRevision: string;
    imageDimensions: number;
    cacheDir: string;
    batchSize: number;
    /** Both the ONNX intra-op count and OpenMP's, pinned together. */
    threads: number;
    offline: boolean;
  };
  yolo: {
    serviceUrl: string;
    serviceToken?: string;
  };
  blockchain: {
    enabled: boolean;
    rpcUrl?: string;
    contractAddress?: string;
    adminPrivateKey?: string;
  };
  /** Non-fatal configuration problems, logged once at boot in every environment. */
  warnings: string[];
}

/**
 * Problems that make the server unable to serve any request at all. These are
 * the only ones that abort boot, and only in production: everything else in
 * this file has a runtime guard and degrades rather than failing, so aborting
 * on it would turn a partly-configured deployment into a crash loop.
 */
function collectCriticalProblems(raw: RawEnv): string[] {
  if (raw.NODE_ENV !== 'production') return [];

  const problems: string[] = [];

  if (!raw.FIREBASE_SERVICE_ACCOUNT_KEY) {
    problems.push(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not set. Firebase Admin would fall back to application default credentials, which do not exist in production, so every read and write fails.',
    );
  }

  if (raw.CLIENT_URL.includes('localhost')) {
    problems.push('CLIENT_URL still points at localhost, so CORS and outbound email links break.');
  }

  if (!raw.HANDOVER_CODE_SECRET || raw.HANDOVER_CODE_SECRET.length < MIN_HANDOVER_SECRET_LENGTH) {
    problems.push(
      `HANDOVER_CODE_SECRET must be set to at least ${MIN_HANDOVER_SECRET_LENGTH} characters. Handover codes are only six digits, so without a server-side HMAC key a leaked hash is reversible by brute force.`,
    );
  }

  return problems;
}

/**
 * Degraded-capability warnings. Reported at boot in every environment, never
 * fatal, because each of these paths already guards itself at runtime.
 */
function collectRequirementProblems(raw: RawEnv): string[] {
  const problems: string[] = [];

  if (
    raw.NODE_ENV !== 'production' &&
    (!raw.HANDOVER_CODE_SECRET || raw.HANDOVER_CODE_SECRET.length < MIN_HANDOVER_SECRET_LENGTH)
  ) {
    problems.push(
      `HANDOVER_CODE_SECRET is not set (or is shorter than ${MIN_HANDOVER_SECRET_LENGTH} characters). Handover codes fall back to a well-known development key, which is fine locally and fatal in production.`,
    );
  }

  if (raw.NODE_ENV !== 'production' && !raw.FIREBASE_SERVICE_ACCOUNT_KEY) {
    problems.push(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not set. Firebase Admin falls back to application default credentials, which only works locally.',
    );
  }

  if (!raw.CLOUDINARY_CLOUD_NAME || !raw.CLOUDINARY_API_KEY || !raw.CLOUDINARY_API_SECRET) {
    problems.push(
      'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must all be set for item image upload to work.',
    );
  }

  const hasLlmKey = Boolean(
    raw.GROQ_API_KEY ||
    raw.GEMINI_API_KEY ||
    raw.GROK_API_KEY ||
    raw.OPENAI_API_KEY ||
    raw.ANTHROPIC_API_KEY ||
    raw.LOCAL_LLM_URL,
  );
  if (!hasLlmKey) {
    problems.push(
      'No AI provider is configured. Set one of GROQ_API_KEY, GEMINI_API_KEY, GROK_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or LOCAL_LLM_URL for a model running locally; matching and CCTV description need at least one.',
    );
  }

  const hasEmailTransport = Boolean(raw.RESEND_API_KEY || (raw.SMTP_USER && raw.SMTP_PASS));
  if (!hasEmailTransport) {
    problems.push(
      'No email transport is configured. Set RESEND_API_KEY, or both SMTP_USER and SMTP_PASS, or handover codes cannot be delivered.',
    );
  }

  if (raw.REDIS_URL && !isRedisUrl(raw.REDIS_URL)) {
    // Reporting this as "not set" would send somebody looking for a variable
    // that is present and wrong.
    problems.push(
      'REDIS_URL is set but is not a redis:// or rediss:// URL, so it is ignored and the queue falls back to running jobs inside the API process.',
    );
  } else if (!raw.REDIS_URL) {
    problems.push(
      'REDIS_URL is not set. Background jobs run inside the API process instead of a worker, so anything in flight is lost on restart and the outbox is drained by the API.',
    );
  }

  if (!raw.YOLO_SERVICE_TOKEN) {
    problems.push(
      'YOLO_SERVICE_TOKEN is not set. The Flask vision service rejects every request without it, so CCTV detection is unavailable.',
    );
  }

  return problems;
}

/**
 * A variable that no longer does anything.
 *
 * Silence would be worse than a warning here: an operator who set
 * `RERANK_MODE=off` to stop paying for the reranker would get the opposite of
 * what they asked for, because it is now the only semantic scorer there is.
 */
function collectRetiredSettingProblems(raw: NodeJS.ProcessEnv): string[] {
  if (!raw.RERANK_MODE) return [];

  return [
    `RERANK_MODE is set to "${raw.RERANK_MODE}" and is no longer read. Batched reranking is the semantic scorer; the per-pair scorer it was measured against has been retired. Remove the variable.`,
  ];
}

/**
 * An inverted or empty adjudication band.
 *
 * Not fatal, because the pipeline reads the band as "low <= score < high" and
 * an empty band simply means nothing is ever adjudicated. That is a quiet way
 * for a feature to be off, so it is said out loud at boot.
 */
function collectAdjudicationProblems(raw: RawEnv): string[] {
  if (raw.ADJUDICATION_MODE === 'off') return [];
  if (raw.ADJUDICATION_BAND_LOW < raw.ADJUDICATION_BAND_HIGH) return [];

  return [
    `ADJUDICATION_BAND_LOW (${raw.ADJUDICATION_BAND_LOW}) is not below ADJUDICATION_BAND_HIGH (${raw.ADJUDICATION_BAND_HIGH}), so the uncertainty band is empty and no pair is ever adjudicated.`,
  ];
}

/**
 * Blockchain is opt-in and its recording step is already non-blocking in
 * `handover.service.ts`, so a missing key degrades the handover record rather
 * than stopping the server.
 */
function collectBlockchainProblems(raw: RawEnv): string[] {
  if (!raw.BLOCKCHAIN_ENABLED) return [];

  const problems: string[] = [];
  if (!raw.CONTRACT_ADDRESS) {
    problems.push('BLOCKCHAIN_ENABLED is true but CONTRACT_ADDRESS is not set.');
  }
  if (!raw.ADMIN_PRIVATE_KEY) {
    problems.push('BLOCKCHAIN_ENABLED is true but ADMIN_PRIVATE_KEY is not set.');
  }
  return problems;
}

/** Exported for the tests; the application uses the `env` built below. */
export function buildEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = rawSchema.safeParse(source);

  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }

  const raw = parsed.data;
  const handoverSecretConfigured = Boolean(
    raw.HANDOVER_CODE_SECRET && raw.HANDOVER_CODE_SECRET.length >= MIN_HANDOVER_SECRET_LENGTH,
  );
  const redisUrl = raw.REDIS_URL && isRedisUrl(raw.REDIS_URL) ? raw.REDIS_URL : undefined;
  const fatal = collectCriticalProblems(raw);

  if (fatal.length > 0) throw new EnvValidationError(fatal);

  const problems = [
    ...collectRequirementProblems(raw),
    ...collectRetiredSettingProblems(source),
    ...collectAdjudicationProblems(raw),
    ...collectBlockchainProblems(raw),
  ];

  return Object.freeze({
    nodeEnv: raw.NODE_ENV,
    isProduction: raw.NODE_ENV === 'production',
    isTest: raw.NODE_ENV === 'test',
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    clientUrl: raw.CLIENT_URL,
    firebase: Object.freeze({
      serviceAccountKey: raw.FIREBASE_SERVICE_ACCOUNT_KEY,
      projectId: raw.FIREBASE_PROJECT_ID,
    }),
    handover: Object.freeze({
      codeSecret: handoverSecretConfigured
        ? (raw.HANDOVER_CODE_SECRET as string)
        : DEVELOPMENT_HANDOVER_SECRET,
      isConfigured: handoverSecretConfigured,
    }),
    cloudinary: Object.freeze({
      cloudName: raw.CLOUDINARY_CLOUD_NAME,
      apiKey: raw.CLOUDINARY_API_KEY,
      apiSecret: raw.CLOUDINARY_API_SECRET,
      isConfigured: Boolean(
        raw.CLOUDINARY_CLOUD_NAME && raw.CLOUDINARY_API_KEY && raw.CLOUDINARY_API_SECRET,
      ),
    }),
    llm: Object.freeze({
      groqApiKey: raw.GROQ_API_KEY,
      geminiApiKey: raw.GEMINI_API_KEY,
      grokApiKey: raw.GROK_API_KEY,
      openaiApiKey: raw.OPENAI_API_KEY,
      anthropicApiKey: raw.ANTHROPIC_API_KEY,
      groqModel: raw.GROQ_MODEL,
      geminiModel: raw.GEMINI_MODEL,
      grokModel: raw.GROK_MODEL,
      openaiModel: raw.OPENAI_MODEL,
      anthropicModel: raw.ANTHROPIC_MODEL,
      localUrl: raw.LOCAL_LLM_URL,
      localModel: raw.LOCAL_LLM_MODEL,
    }),
    ai: Object.freeze({
      dailyBudgetUsd: raw.AI_DAILY_BUDGET_USD,
      monthlyBudgetUsd: raw.AI_MONTHLY_BUDGET_USD,
      requestsPerMinute: raw.AI_REQUESTS_PER_MINUTE,
    }),
    clarifai: Object.freeze({
      apiKey: raw.CLARIFAI_API_KEY,
      pat: raw.CLARIFAI_PAT ?? raw.CLARIFAI_API_KEY,
      userId: raw.CLARIFAI_USER_ID,
      appId: raw.CLARIFAI_APP_ID,
      modelId: raw.CLARIFAI_MODEL_ID,
    }),
    email: Object.freeze({
      resendApiKey: raw.RESEND_API_KEY,
      fromEmail: raw.FROM_EMAIL,
      smtpHost: raw.SMTP_HOST,
      smtpPort: raw.SMTP_PORT,
      smtpUser: raw.SMTP_USER,
      smtpPass: raw.SMTP_PASS,
    }),
    queue: Object.freeze({
      redisUrl: redisUrl,
      isConfigured: Boolean(redisUrl),
      concurrency: raw.QUEUE_CONCURRENCY,
      outboxPollIntervalMs: raw.OUTBOX_POLL_INTERVAL_MS,
      outboxBatchSize: raw.OUTBOX_BATCH_SIZE,
    }),
    matching: Object.freeze({
      retrievalMode: raw.RETRIEVAL_MODE,
      retrievalLimit: raw.RETRIEVAL_LIMIT,
      rerankBatchSize: raw.RERANK_BATCH_SIZE,
      adjudicationMode: raw.ADJUDICATION_MODE,
      adjudicationBandLow: raw.ADJUDICATION_BAND_LOW,
      adjudicationBandHigh: raw.ADJUDICATION_BAND_HIGH,
      adjudicationMaxToolCalls: raw.ADJUDICATION_MAX_TOOL_CALLS,
      adjudicationDeadlineMs: raw.ADJUDICATION_DEADLINE_MS,
      adjudicationMinConfidence: raw.ADJUDICATION_MIN_CONFIDENCE,
    }),
    embeddings: Object.freeze({
      enabled: raw.EMBEDDINGS_ENABLED,
      textModel: raw.EMBEDDING_MODEL,
      textModelRevision: raw.EMBEDDING_MODEL_REVISION,
      textDimensions: raw.EMBEDDING_DIMENSIONS,
      imageModel: raw.EMBEDDING_IMAGE_MODEL,
      imageModelRevision: raw.EMBEDDING_IMAGE_MODEL_REVISION,
      imageDimensions: raw.EMBEDDING_IMAGE_DIMENSIONS,
      cacheDir: raw.MODEL_CACHE_DIR,
      batchSize: raw.EMBEDDING_BATCH_SIZE,
      threads: raw.EMBEDDING_THREADS,
      offline: raw.EMBEDDINGS_OFFLINE,
    }),
    yolo: Object.freeze({
      serviceUrl: raw.YOLO_SERVICE_URL,
      serviceToken: raw.YOLO_SERVICE_TOKEN,
    }),
    blockchain: Object.freeze({
      enabled: raw.BLOCKCHAIN_ENABLED,
      rpcUrl: raw.SEPOLIA_RPC_URL,
      contractAddress: raw.CONTRACT_ADDRESS,
      adminPrivateKey: raw.ADMIN_PRIVATE_KEY,
    }),
    warnings: Object.freeze(problems) as string[],
  });
}

export const env: AppEnv = buildEnv(process.env);

export default env;
