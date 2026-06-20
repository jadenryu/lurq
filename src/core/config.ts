/**
 * Environment configuration (§15). Validated with zod. Most vars are optional
 * so the CLI can run partially (e.g. `lurq --help`) without a full setup;
 * commands that need a specific var call `requireConfig` to fail fast with a
 * clear message.
 */
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

let envLoaded = false;

/** Load `.env` into process.env exactly once. Safe to call repeatedly. */
export function loadEnv(): void {
  if (envLoaded) return;
  dotenvConfig();
  envLoaded = true;
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),

  EMBEDDING_PROVIDER: z.enum(['openai', 'local']).default('openai'),
  EMBEDDING_API_KEY: z.string().min(1).optional(),
  EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),

  SUMMARY_PROVIDER: z.enum(['openai', 'none']).default('openai'),
  SUMMARY_API_KEY: z.string().min(1).optional(),
  SUMMARY_MODEL: z.string().min(1).default('gpt-4o-mini'),

  LURQ_SYNC_CONCURRENCY: z.coerce.number().int().positive().max(50).default(5),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
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
