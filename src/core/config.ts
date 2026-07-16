/**
 * Environment configuration (§15). Validated with zod. Most vars are optional
 * so the CLI can run partially (e.g. `lurq --help`) without a full setup;
 * commands that need a specific var call `requireConfig` to fail fast with a
 * clear message.
 */
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

let envLoaded = false;

/**
 * Load env into process.env exactly once. Safe to call repeatedly.
 *
 * Layering: if `LURQ_ENV_FILE` is set (e.g. `.env.production`), that file loads
 * *first* so its values win, then `.env` fills in the rest (dotenv never
 * overrides an already-set key). This is how the explicit prod path works —
 * `LURQ_ENV_FILE=.env.production` supplies the prod DATABASE_URL while `.env`
 * still provides shared secrets — without prod ever being the ambient default.
 */
export function loadEnv(): void {
  if (envLoaded) return;
  const overrideFile = process.env.LURQ_ENV_FILE;
  if (overrideFile) dotenvConfig({ path: overrideFile });
  dotenvConfig();
  envLoaded = true;
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),

  // 'openai' here means "OpenAI-compatible" — any provider exposing /v1/embeddings
  // + Bearer auth (OpenAI, Together, Fireworks, HF TEI, …). Point *_BASE_URL at it.
  EMBEDDING_PROVIDER: z.enum(['openai', 'local']).default('openai'),
  EMBEDDING_API_KEY: z.string().min(1).optional(),
  EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  EMBEDDING_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  // 'openai' means "OpenAI-compatible /v1/chat/completions": OpenAI, Groq, Together,
  // Fireworks, xAI (Grok), etc. Swap provider by setting SUMMARY_BASE_URL + key + model.
  SUMMARY_PROVIDER: z.enum(['openai', 'none']).default('openai'),
  SUMMARY_API_KEY: z.string().min(1).optional(),
  SUMMARY_MODEL: z.string().min(1).default('gpt-4o-mini'),
  SUMMARY_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  LURQ_SYNC_CONCURRENCY: z.coerce.number().int().positive().max(50).default(5),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Hosted HTTP service (`serve-http`). Server-side only.
  PORT: z.coerce.number().int().positive().default(8080),
  /** Per-API-key rate limit: max requests per window. */
  LURQ_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  /** Coarser per-IP rate limit (blunts unauthenticated floods before auth). */
  LURQ_IP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(240),
  /** Rate-limit window, milliseconds (applies to both limiters). */
  LURQ_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Bearer token guarding `/metrics`. Unset → the endpoint is disabled (404). */
  LURQ_METRICS_TOKEN: z.string().min(1).optional(),
  /** Shared secret for self-serve key issuance (`POST /keys`). The Clerk-
   *  authenticated web app presents it to mint a key for a signed-in user. Unset
   *  → the endpoint is disabled (404). Keep it server-side, never in the client. */
  LURQ_ISSUER_SECRET: z.string().min(1).optional(),

  // Client-side (install wizard / CLI talking to a remote endpoint).
  LURQ_ENDPOINT: z.string().url().optional(),
  LURQ_API_KEY: z.string().min(1).optional(),

  // Sandbox verification. With E2B_API_KEY set, package install + smoke-load
  // runs in an isolated E2B cloud sandbox (safe for UNTRUSTED packages);
  // without it, the local child-process driver is used (trusted packages only).
  E2B_API_KEY: z.string().min(1).optional(),
  // E2B template to launch. Must provide node + npm on PATH; omit for E2B's
  // default. Provision a Node-versioned template here for reproducible runs.
  E2B_TEMPLATE: z.string().min(1).optional(),
});

export type Config = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

let cached: Config | undefined;

/** Parse + validate the environment. Throws ConfigError on malformed values. */
export function getConfig(): Config {
  if (cached) return cached;
  loadEnv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests: clear the memoized config so a fresh getConfig() re-reads
 *  process.env. Does not force a `.env` reload (loadEnv stays idempotent). */
export function resetConfigCache(): void {
  cached = undefined;
}

/**
 * Return the config but fail fast if any of the named required keys are absent.
 * Use in command handlers that genuinely need them (e.g. sync needs DATABASE_URL).
 */
export function requireConfig<K extends keyof Config>(keys: K[]): Config {
  const config = getConfig();
  const missing = keys.filter((k) => config[k] === undefined || config[k] === '');
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        `See .env.example for setup. Tip: copy it to .env and fill in the values.`,
    );
  }
  return config;
}
