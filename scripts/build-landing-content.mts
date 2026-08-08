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

// ---------------------------------------------------------------------------

console.log('stack graph');

const rows = (await sql`
  select name, latest_version, weekly_downloads, peer_dependencies, peer_dependencies_meta, engines
  from packages where name = any(${STACK})`) as Row[];

const missing = STACK.filter((s) => !rows.some((r) => r.name === s));
if (missing.length) throw new Error(`stack packages not in the index: ${missing.join(', ')}`);

const members: CompatMember[] = rows.map((r) => ({
  name: String(r.name),
  version: r.latest_version ? String(r.latest_version) : null,
  peerDependencies: (r.peer_dependencies ?? null) as CompatMember['peerDependencies'],
  peerDependenciesMeta: (r.peer_dependencies_meta ?? null) as CompatMember['peerDependenciesMeta'],
  engines: (r.engines ?? null) as CompatMember['engines'],
}));
const byName = new Map(members.map((m) => [m.name, m]));

/** Co-occurrence witnesses from public dependency graphs — never "verified" (§25.4). */
const witnessRows = (await sql`
  select package_a, package_b, sum(witness_count)::int as witnesses, array_agg(distinct driver) as drivers
  from compat_edges
  where package_a = any(${STACK}) and package_b = any(${STACK}) and status = 'compatible'
  group by 1, 2`) as Row[];
const witnessKey = (a: string, b: string) => [a, b].sort().join('\0');
const witnesses = new Map(
  witnessRows.map((w) => [
    witnessKey(String(w.package_a), String(w.package_b)),
    { witnesses: n(w.witnesses), drivers: (w.drivers as string[]) ?? [] },
  ]),
);

type Edge = {
  source: string;
  target: string;
  verdict: 'declared' | 'conflict' | 'verified';
  provenance: 'declared' | 'verified';
  peer: string;
  range: string;
  optional: boolean;
  detail: string;
  checkedAt: string;
  reproduce: string;
  coOccurrence: { witnesses: number; drivers: string[] } | null;
};

const reproduce = (a: string, b: string) => `npx lurqrun compat ${a} ${b}`;
const satisfied = (version: string, range: string): boolean | null => {
  if (!semver.validRange(range)) return null;
  const v = semver.valid(version) ? version : semver.coerce(version)?.version;
  return v ? semver.satisfies(v, range, { includePrerelease: true }) : null;
};

const edges: Edge[] = [];
for (const m of members) {
  for (const [peer, range] of Object.entries(m.peerDependencies ?? {})) {
    const other = byName.get(peer);
    if (!other?.version || peer === m.name) continue;
    const ok = satisfied(other.version, range);
    if (ok === null) continue;
    edges.push({
      source: m.name,
      target: peer,
      verdict: ok ? 'declared' : 'conflict',
      provenance: 'declared',
      peer,
      range,
      optional: Boolean(m.peerDependenciesMeta?.[peer]?.optional),
      detail: ok
        ? `${m.name}@${m.version} declares peer ${peer}@${range}; the stack's ${peer}@${other.version} satisfies it.`
        : `${m.name}@${m.version} needs peer ${peer}@${range}, but the stack uses ${peer}@${other.version}.`,
      checkedAt: generatedAt,
      reproduce: reproduce(m.name, peer),
      coOccurrence: witnesses.get(witnessKey(m.name, peer)) ?? null,
    });
  }
}

// Conflicts the whole-set solver finds that no single peer declaration explains
// (two members needing disjoint ranges of a peer that isn't in the stack, or
// engine ranges that can't both hold). Same function the `compat` tool serves.
const setConflicts = resolveArchitectureCompat(members);
for (const c of setConflicts) {
  const [a, b] = c.packages;
  if (!a || !b || !byName.has(a) || !byName.has(b)) continue;
  const already = edges.some(
    (e) =>
      e.verdict === 'conflict' &&
      ((e.source === a && e.target === b) || (e.source === b && e.target === a)),
  );
  if (already) continue;
  edges.push({
    source: a,
    target: b,
    verdict: 'conflict',
    provenance: 'declared',
    peer: c.source === 'engines' ? 'node' : '',
    range: '',
    optional: false,
    detail: `${c.detail}.`,
    checkedAt: generatedAt,
    reproduce: reproduce(a, b),
    coOccurrence: witnesses.get(witnessKey(a, b)) ?? null,
  });
}

/**
 * Every pair in the stack, at the strongest level of evidence we hold for it.
 *
 * The page renders this as a matrix, so unlike the edge list it needs the pairs
 * we know something weaker about, and it needs the blanks. Four levels:
 *
 *   conflict  — the two packages' declared metadata disagree
 *   declared  — a declared peer relationship that resolves
 *   co-occurs — no declared relationship, but N public dependency graphs
 *               resolve them side by side. Weaker, and never called verified
 *   (blank)   — no evidence at all, which is most of the matrix and is the
 *               honest part: untested is shown as untested
 */
type PairCell = {
  a: string;
  b: string;
  level: 'conflict' | 'declared' | 'co-occurs';
  detail: string;
  witnesses: number | null;
  reproduce: string;
};

const pairKey = (a: string, b: string) => [a, b].sort().join('\0');
const declaredByPair = new Map(edges.map((e) => [pairKey(e.source, e.target), e]));
const pairs: PairCell[] = [];

for (let i = 0; i < members.length; i++) {
  for (let j = i + 1; j < members.length; j++) {
    const a = members[i]!.name;
    const b = members[j]!.name;
    const declared = declaredByPair.get(pairKey(a, b));
    const witness = witnesses.get(witnessKey(a, b));
    if (declared) {
      pairs.push({
        a: declared.source,
        b: declared.target,
        level: declared.verdict === 'conflict' ? 'conflict' : 'declared',
        detail: declared.detail,
        witnesses: witness?.witnesses ?? null,
        reproduce: declared.reproduce,
      });
    } else if (witness) {
      pairs.push({
        a,
        b,
        level: 'co-occurs',
        detail: `Neither package declares the other. ${witness.witnesses.toLocaleString('en-US')} public dependency graphs resolve them side by side — co-occurrence, not a verified install.`,
        witnesses: witness.witnesses,
        reproduce: reproduce(a, b),
      });
    }
  }
}

const nodes = members
  .map((m) => {
    const row = rows.find((r) => r.name === m.name)!;
    const degree = edges.filter((e) => e.source === m.name || e.target === m.name).length;
    return {
      id: m.name,
      version: m.version,
      weeklyDownloads: n(row.weekly_downloads),
      declaresPeers: Object.keys(m.peerDependencies ?? {}).length,
      nodeEngine: (m.engines?.node as string | undefined) ?? null,
      degree,
      conflicts: edges.filter(
        (e) => e.verdict === 'conflict' && (e.source === m.name || e.target === m.name),
      ).length,
    };
  })
  .sort((a, b) => b.weeklyDownloads - a.weeklyDownloads);

await write('stack-graph.json', {
  generatedAt,
  source: 'live',
  stackName: STACK_NAME,
  checkedAt: generatedAt,
  dataAsOf: iso(counts?.data_as_of),
  nodes,
  edges,
  pairs,
  counts: {
    nodes: nodes.length,
    edges: edges.length,
    declared: edges.filter((e) => e.verdict === 'declared').length,
    conflict: edges.filter((e) => e.verdict === 'conflict').length,
    verified: edges.filter((e) => e.verdict === 'verified').length,
    isolated: nodes.filter((x) => x.degree === 0).map((x) => x.id),
    /** Unique unordered pairs in the set — the size of the matrix. */
    possiblePairs: (members.length * (members.length - 1)) / 2,
    coOccurs: pairs.filter((p) => p.level === 'co-occurs').length,
    known: pairs.length,
  },
});

// ---------------------------------------------------------------------------

console.log('usage diff');

// Read-through the surface cache, extracting from the shipped .d.ts on a miss —
// the same service the usage tool and the discovery worker call. Storing both
// versions also means `lurqrun usage puppeteer --known 21.11.0` reproduces this
// exact delta against the hosted server.
const [knownSurface, targetSurface] = await Promise.all([
  getOrExtractSurface(db, USAGE_EXAMPLE.pkg, USAGE_EXAMPLE.known),
  getOrExtractSurface(db, USAGE_EXAMPLE.pkg, USAGE_EXAMPLE.target),
]);
if (!knownSurface || !targetSurface) {
  throw new Error(`no extractable API surface for ${USAGE_EXAMPLE.pkg}; pick another package`);
}
const delta = diffSurface(knownSurface, targetSurface);

/**
 * Every export in the surface, tagged with what happened to it, in the old
 * version's declaration order with the new exports appended. The page renders
 * this as a grid — one square per export — so the *shape* of a breaking change
 * is visible before any names are read. Order matters: keeping the original
 * declaration order puts the removals where they actually were rather than
 * gathering them into a tidy block.
 */
type SurfaceCell = { name: string; kind: string; status: string };
const renamedFrom = new Map(delta.renamed.map((r) => [r.from.name, r.to.name]));
const changedNames = new Set(delta.changed.map((c) => c.name));
const removedNames = new Set(delta.removed.map((s) => s.name));

const cells: SurfaceCell[] = knownSurface.map((s) => ({
  name: s.name,
  kind: s.kind,
  status: removedNames.has(s.name)
    ? 'removed'
    : renamedFrom.has(s.name)
      ? 'renamed'
      : changedNames.has(s.name)
        ? 'changed'
        : 'unchanged',
}));
for (const s of delta.added) cells.push({ name: s.name, kind: s.kind, status: 'added' });

await write('usage-diff.json', {
  generatedAt,
  source: 'live',
  package: USAGE_EXAMPLE.pkg,
  fromVersion: USAGE_EXAMPLE.known,
  toVersion: USAGE_EXAMPLE.target,
  surfaceSize: { from: knownSurface.length, to: targetSurface.length },
  delta: { ...delta, fromVersion: USAGE_EXAMPLE.known },
  cells,
  renamedTo: Object.fromEntries(renamedFrom),
  unchanged: cells.filter((c) => c.status === 'unchanged').length,
  counts: {
    removed: delta.removed.length,
    added: delta.added.length,
    renamed: delta.renamed.length,
    changed: delta.changed.length,
  },
  reproduce: `npx lurqrun usage ${USAGE_EXAMPLE.pkg} --known ${USAGE_EXAMPLE.known}`,
});

// ---------------------------------------------------------------------------

console.log('verify');

const verify = [];
for (const pkg of VERIFY_EXAMPLES) {
  verify.push({ package: pkg, result: await handleVerify(db, { package: pkg }), reproduce: `npx lurqrun verify ${pkg}` });
}
await write('verify-example.json', { generatedAt, source: 'live', checks: verify });

// ---------------------------------------------------------------------------

console.log('stack check');

const compat = await handleCompat(db, { packages: COMPAT_EXAMPLE });
await write('compat-example.json', {
  generatedAt,
  source: 'live',
  result: compat,
  reproduce: `npx lurqrun compat ${COMPAT_EXAMPLE.join(' ')}`,
});

// ---------------------------------------------------------------------------

console.log('weights');

// Read straight out of the scoring module rather than transcribing the numbers:
// src/scoring/weights.ts is the only place the model is defined, so the page
// can't disagree with the code that ranks.
const { loadWeights, activeWeightsPath } = await import('../src/scoring/weights');
const active = loadWeights();
const weightsSource = activeWeightsPath()?.source ?? 'defaults';

await write('weights-example.json', {
  generatedAt,
  source: 'live',
  overridden: weightsSource !== 'defaults',
  weightsSource,
  /** The four health components, in weight order, each with its raw signal. */
  health: (
    [
      ['maintenance', 'release recency, cadence, and issue close-ratio'],
      ['adoption', 'weekly downloads (log-scaled), stars, and 90-day growth'],
      ['reliability', 'OpenSSF Scorecard 0–100, minus advisory penalties'],
      ['efficiency', 'bundle size against the category median; frontend only'],
    ] as const
  ).map(([key, signal]) => ({
    key,
    weight: active.health[key],
    signal,
  })),
  quality: {
    components: Object.entries(QUALITY_WEIGHTS).map(([key, weight]) => ({ key, weight })),
    note: 'adoption-independent: how well-built the package is, not how many people use it',
  },
  composite: {
    lambda: active.composite.lambda,
    formula: 'composite = (1 − λ)·health + λ·quality',
  },
  promising: {
    minQuality: CONFIDENCE.promising.minQuality,
    maxLastReleaseMonths: CONFIDENCE.promising.maxLastReleaseMonths,
  },
  reproduce: 'npx lurqrun weights',
});

await close();
console.log('done');
