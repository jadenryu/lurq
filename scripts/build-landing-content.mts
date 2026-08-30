/**
 * Generates every data artifact the landing page renders.
 *
 * Nothing on the marketing page is written by hand: each JSON file below comes
 * out of the same code path the MCP server and CLI serve (`src/mcp/handlers`,
 * `src/compat/peerCompat`, `src/usage/*`) or out of a direct read of the
 * production database. Re-run it whenever the page's numbers should move:
 *
 *   npx tsx scripts/build-landing-content.mts
 *
 * Every file carries `generatedAt` and `source: 'live'`. The graph component
 * refuses to build with `source: 'fixture'` in production (see
 * apps/web/src/lib/stack-graph.ts), so a placeholder can never ship by accident.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { createDb } from '../src/db/client';
import { handleCompat, handleVerify } from '../src/mcp/handlers';
import { resolveArchitectureCompat, type CompatMember } from '../src/compat/peerCompat';
import { getOrExtractSurface } from '../src/usage/service';
import { diffSurface } from '../src/usage/diff';
import { CONFIDENCE, QUALITY_WEIGHTS } from '../src/scoring/weights';

const OUT = path.join(process.cwd(), 'apps/web/src/content/generated');

/**
 * The example stack (§23): picked because every name is instantly recognisable
 * and the honest output is *not* all green — the linter plugin has not caught up
 * to TypeScript 7, and next-auth pins an exact @auth/core that has moved on.
 */
const STACK_NAME = 'a next.js app with auth, an orm, and tests';
const STACK = [
  'next',
  'react',
  'react-dom',
  'typescript',
  'tailwindcss',
  'eslint',
  '@typescript-eslint/eslint-plugin',
  'next-auth',
  '@auth/core',
  'drizzle-orm',
  'postgres',
  'zod',
  'vite',
  'vitest',
  '@playwright/test',
  'framer-motion',
  'react-hook-form',
  '@tanstack/react-query',
  'prisma',
];

/** The §15 usage artifact: a real breaking major, diffed from the shipped .d.ts. */
const USAGE_EXAMPLE = { pkg: 'puppeteer', known: '21.11.0', target: '24.14.0' };

/** The §15 verify artifacts: a live typosquat and a deprecated package with an advisory. */
const VERIFY_EXAMPLES = ['momnet', 'request'];

/** The §15 stack-check artifact — a subset small enough to read in one screen. */
const COMPAT_EXAMPLE = [
  'next',
  'react',
  'react-dom',
  'typescript',
  'eslint',
  '@typescript-eslint/eslint-plugin',
  'next-auth',
  '@auth/core',
];

/**
 * Upstream data sources, one entry per module under src/ingestion/sources plus
 * the CDN the usage axis parses types from. Kept in sync by hand with that
 * directory — the count on the page is derived from this array, never typed in.
 */
const SOURCES = [
  {
    name: 'npm registry',
    host: 'registry.npmjs.org',
    short: 'versions, peer ranges, engines',
    contributes: 'versions, deprecations, peer ranges, engines, licence',
  },
  {
    name: 'npm downloads',
    host: 'api.npmjs.org',
    short: 'weekly downloads, 90-day trend',
    contributes: 'weekly downloads and 90-day trend',
  },
  {
    name: 'npm search',
    host: 'registry.npmjs.org/-/v1/search',
    short: 'discovery candidates',
    contributes: 'discovery candidates per category',
  },
  {
    name: 'GitHub API',
    host: 'api.github.com',
    short: 'stars, issues, last release',
    contributes: 'stars, issues, last release, archived flag',
  },
  {
    name: 'GitHub raw',
    host: 'raw.githubusercontent.com',
    short: 'README text',
    contributes: 'README text for the usage guide',
  },
  {
    name: 'deps.dev',
    host: 'api.deps.dev',
    short: 'dependency graphs',
    contributes: 'dependency graphs and version metadata',
  },
  {
    name: 'OpenSSF Scorecard',
    host: 'api.deps.dev/v3/projects',
    short: 'supply-chain review',
    contributes: 'supply-chain review, branch protection, CI checks',
  },
  {
    name: 'OSV advisories',
    host: 'api.deps.dev/v3/advisories',
    short: 'open vulnerabilities',
    contributes: 'open vulnerabilities per version',
  },
  {
    name: 'Bundlephobia',
    host: 'bundlephobia.com',
    short: 'min+gzip install cost',
    contributes: 'min+gzip install cost',
  },
  {
    name: 'jsDelivr',
    host: 'cdn.jsdelivr.net',
    short: 'the shipped .d.ts',
    contributes: 'the shipped .d.ts the usage axis parses',
  },
] as const;

const NPM_PACKAGE = 'lurqrun';

type Row = Record<string, unknown>;

function n(v: unknown): number {
  return typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function write(file: string, data: unknown): Promise<void> {
  await writeFile(path.join(OUT, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`  wrote ${file}`);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

const { db, sql, close } = createDb({ max: 4 });
await mkdir(OUT, { recursive: true });
const generatedAt = new Date().toISOString();

console.log('stats + provenance');

const [counts] = (await sql`
  select
    (select count(*) from packages)                                        as packages,
    (select count(*) from packages where health_score is not null)         as scored,
    (select count(distinct category) from packages where category is not null) as categories,
    (select count(*) from package_versions)                                as versions,
    (select count(*) from api_surfaces)                                    as api_surfaces,
    (select count(*) from compat_edges)                                    as compat_edges,
    (select max(data_as_of) from packages)                                 as data_as_of`) as Row[];

const [lastSync] = (await sql`
  select started_at, finished_at, packages_seen, packages_updated, status
  from sync_runs where finished_at is not null
  order by finished_at desc limit 1`) as Row[];

const [syncCadence] = (await sql`
  select count(distinct date_trunc('day', started_at)) as days,
         min(started_at) as first_run
  from sync_runs`) as Row[];

// Real npm downloads since first publish. Never called "users" (§25.2).
const registry = await fetchJson<{
  time: Record<string, string>;
  'dist-tags': Record<string, string>;
}>(`https://registry.npmjs.org/${NPM_PACKAGE}`);
const firstPublish = registry?.time?.created ?? null;
const publishedVersions = registry?.time
  ? Object.keys(registry.time).filter((k) => k !== 'created' && k !== 'modified').length
  : null;
const today = new Date().toISOString().slice(0, 10);
const downloads = firstPublish
  ? await fetchJson<{ downloads: number }>(
      `https://api.npmjs.org/downloads/point/${firstPublish.slice(0, 10)}:${today}/${NPM_PACKAGE}`,
    )
  : null;

const weeksLive = firstPublish
  ? Math.floor((Date.now() - new Date(firstPublish).getTime()) / (7 * 24 * 3600 * 1000))
  : null;

await write('stats.json', {
  generatedAt,
  source: 'live',
  dataAsOf: iso(counts?.data_as_of),
  packages: n(counts?.packages),
  packagesScored: n(counts?.scored),
  categories: n(counts?.categories),
  versionsTracked: n(counts?.versions),
  apiSurfaces: n(counts?.api_surfaces),
  coOccurrencePairs: n(counts?.compat_edges),
  dataSources: SOURCES.length,
  npm: {
    package: NPM_PACKAGE,
    latestVersion: registry?.['dist-tags']?.latest ?? null,
    publishedVersions,
    firstPublishedAt: firstPublish,
    downloadsSincePublish: downloads?.downloads ?? null,
    weeksLive,
  },
  lastSync: lastSync
    ? {
        startedAt: iso(lastSync.started_at),
        finishedAt: iso(lastSync.finished_at),
        packagesSeen: n(lastSync.packages_seen),
        packagesUpdated: n(lastSync.packages_updated),
        status: String(lastSync.status),
      }
    : null,
  syncDays: n(syncCadence?.days),
});

await write('provenance.json', {
  generatedAt,
  source: 'live',
  sources: SOURCES,
  dataAsOf: iso(counts?.data_as_of),
  versionsTracked: n(counts?.versions),
  coOccurrencePairs: n(counts?.compat_edges),
  apiSurfaces: n(counts?.api_surfaces),
  syncDays: n(syncCadence?.days),
  firstSyncAt: iso(syncCadence?.first_run),
  lastSync: lastSync
    ? {
        finishedAt: iso(lastSync.finished_at),
        packagesSeen: n(lastSync.packages_seen),
        status: String(lastSync.status),
      }
    : null,
});

await close();
console.log('done');
