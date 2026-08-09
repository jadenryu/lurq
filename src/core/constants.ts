/** Static identifiers shared across the CLI and MCP server. */
import pkg from '../../package.json' with { type: 'json' };

export const SERVER_NAME = 'lurq';
/** Published npm package name (the CLI command and MCP nickname stay `lurq`).
 *  Keep in sync with package.json "name". */
export const PACKAGE_NAME = 'lurqrun';
/**
 * Read from package.json rather than restated, so a release bump cannot leave
 * it behind. This used to be a literal under a "keep in sync" comment, and it
 * drifted the moment someone bumped package.json alone: 0.0.9 shipped to npm
 * announcing itself as 0.0.8.
 *
 * That is not only cosmetic. github/workflow.ts defaults `cliSpec()` to this
 * value and bakes it into the `npx lurqrun@<v>` line of every workflow lurq
 * generates, so a stale constant writes users a CI job pinned to a version
 * other than the one that wrote it.
 *
 * The import is resolved at build time — esbuild inlines the JSON, so there is
 * no file read at runtime and no dependence on where the bundle sits on disk.
 * That last part is why this is an import and not a `readFileSync` of a path
 * relative to `import.meta.url`: the public bin lands at dist/bin/lurq.js and
 * the library entry at dist/index.js, so any relative path correct for one is
 * wrong for the other.
 */
export const VERSION: string = pkg.version;

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
