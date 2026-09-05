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

/** Anything shorter is not worth calling a key, so it counts as unset. */
const MIN_HANDOVER_SECRET_LENGTH = 32;

/**
 * Only ever used outside production. It keeps codes issued before a restart
 * verifiable on a developer machine; production boot fails without a real key.
 */
const DEVELOPMENT_HANDOVER_SECRET = 'reclaim-development-handover-code-secret';

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

  const hasLlmKey = Boolean(raw.GROQ_API_KEY || raw.GEMINI_API_KEY || raw.GROK_API_KEY);
  if (!hasLlmKey) {
    problems.push(
      'No LLM provider key is set. At least one of GROQ_API_KEY, GEMINI_API_KEY or GROK_API_KEY is required for matching and CCTV description.',
    );
  }

  const hasEmailTransport = Boolean(raw.RESEND_API_KEY || (raw.SMTP_USER && raw.SMTP_PASS));
  if (!hasEmailTransport) {
    problems.push(
      'No email transport is configured. Set RESEND_API_KEY, or both SMTP_USER and SMTP_PASS, or handover codes cannot be delivered.',
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

function buildEnv(source: NodeJS.ProcessEnv): AppEnv {
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
  const fatal = collectCriticalProblems(raw);

  if (fatal.length > 0) throw new EnvValidationError(fatal);

  const problems = [...collectRequirementProblems(raw), ...collectBlockchainProblems(raw)];

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
