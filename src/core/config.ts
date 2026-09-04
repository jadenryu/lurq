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

  /**
   * How many `npm install --package-lock-only` processes may run at once.
   *
   * Each one holds npm's arborist tree in memory — 200-500MB for a real stack —
   * so this is a memory cap wearing a concurrency hat. Eight concurrent resolves
   * is ~3GB and will OOM a small container; the work is network-bound anyway, so
   * raising it buys throughput only until the box runs out of RAM.
   */
  LURQ_RESOLVE_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),
  /**
   * Where npm keeps its metadata cache for stack resolution.
   *
   * Point this at a persistent volume in production. A warm cache is the
   * difference between 8.6s and 19.2s on a 15-package stack (measured), and an
   * ephemeral container filesystem means every redeploy pays cold cost again for
   * the first few hundred resolves. Unset = npm's default location.
   */
  LURQ_NPM_CACHE_DIR: z.string().min(1).optional(),
  /** Budget for one stack resolve. Past this the answer is `unknown`, never a
   *  guess — and nothing is cached, so the next ask gets a real attempt. */
  LURQ_RESOLVE_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),

  LURQ_SYNC_CONCURRENCY: z.coerce.number().int().positive().max(50).default(5),
  /** Stalest non-seed packages the daily sync refreshes on top of the seed list.
   *  This is the rotation rate for everything discovery ingested: index size /
   *  this = days to come all the way around. Raise it if the sync finishes well
   *  inside the cron window; lower it if npm starts rate-limiting. 0 disables
   *  the rotation (seeds only, the pre-rotation behaviour).
   *
   *  It is also the discovery frontier's clock, which is why it is not a small
   *  number. `graphChannel` re-expands a package only when its `latest_version`
   *  moves, and nothing observes a version move except this rotation — so at 400
   *  against a 20.8k index the graph channel could only re-arm on a 52-day lag
   *  and had gone effectively silent. */
  LURQ_SYNC_REFRESH_CAP: z.coerce.number().int().min(0).max(25_000).default(2000),
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

  // Billing (Stripe). Every secret here lives on this service and nowhere else:
  // the web app holds no Stripe credential and reaches checkout through the
  // issuer-secret routes, the same way it reaches key issuance. Unset →
  // /billing/* is disabled (404) and every account is served the free tier, so
  // a deployment without Stripe configured degrades to "free for everyone"
  // rather than to "nobody can call anything".
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  /** Signing secret for `POST /billing/webhook`. Unset → the endpoint is 404. */
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Price id backing the Pro plan. Unset → Pro cannot be checked out. */
  /**
   * Whether Stripe Managed Payments applies to our Checkout Sessions: Stripe as
   * merchant of record, taking over indirect tax registration and remittance,
   * disputes and fraud — the half `automatic_tax` alone does not buy.
   *
   * ALWAYS SENT, in both directions, and that is the point. Managed Payments has
   * an account-level default (on, for accounts created since it shipped), so
   * omitting the parameter hands the decision to a dashboard toggle instead of
   * to config. That is action at a distance: the same deploy behaves differently
   * per account, and the failure it produces is a 400 at the moment someone
   * tries to pay. Sending it explicitly makes the deployment the authority.
   *
   * Defaults true to match the account default. Every product must carry an
   * eligible `tax_code` (see billing/provision.ts) or Stripe rejects the session,
   * so `false` is the one-variable escape hatch if eligibility is ever in doubt.
   */
  STRIPE_MANAGED_PAYMENTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  /** Price id backing Enterprise. Normally unset: Enterprise is sold by
   *  conversation, and `contactOnly` in core/plans.ts is what the page reads. */
  STRIPE_PRICE_ENTERPRISE: z.string().min(1).optional(),
  /** Absolute base URL the checkout returns to, e.g. https://lurq.run. */
  LURQ_WEB_URL: z.string().url().default('https://lurq.run'),

  // GitHub App (repo autopilot). Only the App itself holds repo access; lurq
  // never stores a user's personal token. Either unset → /repos is disabled (404).
  // The App *slug* is deliberately not here: only the web app needs it, to build
  // the install link, and it reads process.env directly.
  /** Numeric App ID from the GitHub App settings page. */
  LURQ_GITHUB_APP_ID: z.string().min(1).optional(),
  /** PEM private key. Accepts literal newlines or `\n` escapes (Railway/Vercel). */
  LURQ_GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  /** Webhook secret from the same App settings page, so repo changes made on
   *  GitHub reach us. Unset → `POST /github/webhook` is disabled (404): an
   *  unverified webhook is an open write endpoint, so no secret means no route. */
  LURQ_GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),

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

  // Lurq bakeoff testing toggle b/w local and prod DB
  USE_LIVE_API: z.string().min(1).optional(),
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
