/** Static identifiers shared across the CLI and MCP server. */
export const SERVER_NAME = 'lurq';
/** Published npm package name (the CLI command and MCP nickname stay `lurq`).
 *  Keep in sync with package.json "name". */
export const PACKAGE_NAME = 'lurqrun';
/** Keep in sync with package.json "version". */
export const VERSION = '0.0.1';

/** Default hosted endpoint the install wizard writes into agent configs. The
 *  marketing site is `lurq.run`; the MCP service lives on the `api.` subdomain.
 *  Overridable per-invocation with `lurq install --url …` or `LURQ_ENDPOINT`. */
export const DEFAULT_ENDPOINT = 'https://api.lurq.run/mcp';

/** Prefix for issued API keys (the rest is high-entropy random). */
export const API_KEY_PREFIX = 'lurq_live_';

/** Embedding vector dimensionality (OpenAI text-embedding-3-small). The local
 *  fallback embedder produces vectors of the same length so the DB column and
 *  pgvector index never need to change. */
export const EMBEDDING_DIM = 1536;

/** A package row is flagged `stale: true` in tool responses once its data is
 *  older than this (§17). */
export const STALENESS_DAYS = 7;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Per-source persistent-cache TTLs (§17). */
export const CACHE_TTL = {
  npmRegistry: 6 * HOUR,
  npmDownloads: 12 * HOUR,
  github: 12 * HOUR,
  depsDev: 24 * HOUR,
  bundlephobia: 7 * DAY,
} as const;
