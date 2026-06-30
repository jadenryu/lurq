/**
 * MCP tool handlers (§12.3). Pure functions over a Database — the transport
 * layer (server.ts) just wires zod schemas to these. Responses are kept compact
 * (§12.4): summaries truncated, advisories capped, no raw payloads, always a
 * `dataAsOf` and a `stale` hint when data is old (§17).
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { cached } from '../core/cache';
import { STALENESS_DAYS } from '../core/constants';
import type {
  Advisory,
  AdvisorySeverity,
  BuildVerified,
  Category,
  CompatConflict,
  CompatOutput,
  Confidence,
  EvaluateOutput,
  VerifyOutput,
} from '../core/types';
import { assembleMembers } from '../compat/members';
import { resolveArchitectureCompat } from '../compat/peerCompat';
import { getCompatEdges } from '../db/compat';
import type { Database } from '../db/client';
import { getTopPackageNames } from '../db/packages';
import { getLatestVerificationByName } from '../db/verification';
import type { VerificationRunRow } from '../db/schema';
import { packages, type PackageRow } from '../db/schema';
import { fetchNpmRegistry, npmPackageExists } from '../ingestion/sources';
import { truncateSentences } from '../ingestion/summarize';
import { getOrFetchPackage } from '../pipeline/single';
import { hasCriticalOrHighAdvisory } from '../scoring/score';
import { recommend, type RecommendOptions } from '../search/recommend';
import { assessRisk } from '../security/risk';
import { detectTyposquat } from '../security/typosquat';

const SEVERITY_RANK: Record<AdvisorySeverity, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
  info: 0,
};
const DAY_MS = 24 * 60 * 60 * 1000;

function isStale(dataAsOf: Date | null): boolean {
  if (!dataAsOf) return true;
  return Date.now() - dataAsOf.getTime() > STALENESS_DAYS * DAY_MS;
}

/** Re-derive the wall-clock `stale` hint (§17) on a (possibly cached) evaluate
 *  row, so a cached response doesn't keep claiming fresh data after it ages past
 *  the threshold between syncs. */
function refreshStale(out: EvaluateOutput): EvaluateOutput {
  out.stale = isStale(out.dataAsOf ? new Date(out.dataAsOf) : null) || undefined;
  return out;
}

function withinDays(date: Date | null, days: number): boolean {
  return date ? Date.now() - date.getTime() <= days * DAY_MS : false;
}

/** Top advisories by severity, capped (§12.4). */
function topAdvisories(advisories: Advisory[] | null, max = 5): Advisory[] {
  if (!advisories?.length) return [];
  return [...advisories]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, max);
}

/** Map a stored row to the compact EvaluateOutput shape (§12.3.2). */
export function rowToEvaluate(row: PackageRow): EvaluateOutput {
  const breakdown = row.scoreBreakdown ?? {
    maintenance: 0,
    adoption: 0,
    reliability: 0,
    efficiency: null,
    quality: null,
  };
  return {
    dataAsOf: (row.dataAsOf ?? new Date()).toISOString(),
    stale: isStale(row.dataAsOf) || undefined,
    name: row.name,
    category: row.category,
    healthScore: row.healthScore ?? 0,
    qualityScore: row.qualityScore ?? null,
    confidence: (row.confidence as Confidence) ?? 'unproven',
    scoreBreakdown: breakdown,
    latestVersion: row.latestVersion,
    lastReleaseAt: row.lastReleaseAt ? row.lastReleaseAt.toISOString() : null,
    weeklyDownloads: row.weeklyDownloads,
    downloadGrowth90d: row.downloadGrowth90d,
    dependentsCount: row.dependentsCount,
    scorecard: row.scorecard,
    bundleMinGzipKb: row.bundleMinGzipKb,
    deprecated: row.deprecated,
    archived: row.archived,
    advisories: topAdvisories(row.advisories),
    summary: row.summary ? truncateSentences(row.summary, 3) : null,
    usageGuide: row.usageGuide ?? null,
    repoUrl: row.repoUrl,
  };
}

export async function latestDataAsOf(db: Database): Promise<string> {
  const [row] = await db
    .select({ m: sql<string | null>`max(${packages.dataAsOf})` })
    .from(packages);
  return new Date(row?.m ?? Date.now()).toISOString();
}

// ── recommend ───────────────────────────────────────────────────────────────

export interface RecommendInput {
  need: string;
  category?: Category;
  constraints?: RecommendOptions['constraints'];
}

/** Short, stable cache key from arbitrary input. */
function cacheKey(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

export async function handleRecommend(db: Database, input: RecommendInput) {
  return cached(
    'rec',
    cacheKey([input.need, input.category ?? null, input.constraints ?? null]),
    async () => {
      const candidates = await recommend(db, {
        need: input.need,
        category: input.category,
        constraints: input.constraints,
        limit: 5,
      });
      return { dataAsOf: await latestDataAsOf(db), candidates };
    },
    // Don't cache empty results — the index may still be populating.
    { skipCache: (r) => r.candidates.length === 0 },
  );
}

// ── evaluate ────────────────────────────────────────────────────────────────

export async function handleEvaluate(
  db: Database,
  input: { package: string },
): Promise<EvaluateOutput | { tracked: false; suggestion: string }> {
  const out = await cached(
    'eval',
    cacheKey([input.package]),
    async () => {
      const { row, existsOnNpm } = await getOrFetchPackage(db, input.package);
      if (!row) {
        return {
          tracked: false as const,
          suggestion: existsOnNpm
            ? `"${input.package}" exists on npm but could not be scored right now; try again.`
            : `"${input.package}" was not found on the npm registry. Check the package name.`,
        };
      }
      const evaluated = rowToEvaluate(row);
      const verification = await getLatestVerificationByName(db, row.name);
      return verification
        ? { ...evaluated, buildVerified: toBuildVerified(verification) }
        : evaluated;
    },
    // Don't cache "not found / not scored yet" — it may resolve on a later fetch.
    { skipCache: (r) => 'tracked' in r },
  );
  // Re-derive the time-based stale hint, which a cached row would otherwise freeze.
  return 'tracked' in out ? out : refreshStale(out);
}

// ── compare ─────────────────────────────────────────────────────────────────

export async function handleCompare(db: Database, input: { packages: string[] }) {
  // Key on the exact input — the response echoes the caller's own names/order in
  // `missing`, so a normalized key would serve another caller's casing.
  const out = await cached(
    'cmp',
    cacheKey(input.packages),
    async () => {
      const results = await Promise.all(input.packages.map((name) => getOrFetchPackage(db, name)));
      const rows = results
        .map((r) => r.row)
        .filter((row): row is PackageRow => row !== null)
        .map(rowToEvaluate)
        .sort((a, b) => b.healthScore - a.healthScore);
      const missing = input.packages.filter((name) => !rows.some((r) => r.name === name));
      return { dataAsOf: await latestDataAsOf(db), rows, ...(missing.length ? { missing } : {}) };
    },
    // Don't cache a transient miss (a package that momentarily failed to fetch).
    { skipCache: (r) => Boolean((r as { missing?: string[] }).missing?.length) },
  );
  out.rows = out.rows.map(refreshStale);
  return out;
}

// ── compat ──────────────────────────────────────────────────────────────────

function toBuildVerified(v: VerificationRunRow): BuildVerified {
  return {
    version: v.version,
    installed: v.installed,
    loaded: v.imported,
    driver: v.driver,
    ranAt: v.ranAt ? v.ranAt.toISOString() : '',
  };
}

/**
 * Whole-architecture compatibility for a set of packages.
 *
 * Tier 1 (instant, deterministic): peer-dependency + engine range analysis from
 * stored metadata. Tier 2 (empirical): any recorded sandbox co-install conflicts
 * are folded in. `overall` is `conflict` if anything clashes, `unknown` if a
 * member couldn't be resolved at all, else `compatible`.
 */
export async function handleCompat(
  db: Database,
  input: { packages: string[] },
): Promise<CompatOutput> {
  const names = [...new Set(input.packages)];
  const { members, unverified } = await assembleMembers(db, names);

  const conflicts: CompatConflict[] = resolveArchitectureCompat(members);

  // Fold in empirical sandbox conflicts (Tier 2), if any were recorded.
  for (const edge of await getCompatEdges(db, names)) {
    if (edge.status === 'conflict') {
      conflicts.push({
        source: 'sandbox',
        packages: [edge.packageA, edge.packageB],
        detail: `${edge.packageA}@${edge.versionA} and ${edge.packageB}@${edge.versionB} failed to co-install in the sandbox`,
      });
    }
  }

  const overall = conflicts.length
    ? 'conflict'
    : unverified.length
      ? 'unknown'
      : 'compatible';
  return { packages: names, overall, conflicts, unverified };
}

// ── verify ──────────────────────────────────────────────────────────────────

export async function handleVerify(
  db: Database,
  input: { package: string },
): Promise<VerifyOutput> {
  const name = input.package;
  const exists = await npmPackageExists(name);
  if (!exists) {
    // A name that doesn't exist but closely mimics a popular one is a squat the
    // agent was about to fall for — surface the suspected target.
    const typo = detectTyposquat(name, await getTopPackageNames(db).catch(() => []));
    return {
      exists: false,
      tracked: false,
      deprecated: false,
      archived: false,
      latestVersion: null,
      weeklyDownloads: null,
      riskFlags: typo
        ? ['not-found-on-registry', `possible-typosquat-of:${typo.target}`]
        : ['not-found-on-registry'],
      risk: 'high',
      typosquatOf: typo?.target ?? null,
      confidence: null,
      advisoryCount: 0,
    };
  }

  const [registry, { row, wasTracked }, popular] = await Promise.all([
    fetchNpmRegistry(name).catch(() => null),
    getOrFetchPackage(db, name),
    getTopPackageNames(db).catch(() => [] as string[]),
  ]);

  const weeklyDownloads = row?.weeklyDownloads ?? null;
  const advisories = row?.advisories ?? [];
  const advisoryCount = advisories.length;
  const deprecated = Boolean(row?.deprecated || registry?.deprecated);
  const archived = Boolean(row?.archived);
  const brandNew = withinDays(registry?.firstPublishedAt ?? null, 7);
  const lowTrust = weeklyDownloads === null || weeklyDownloads < 1000;
  const installScripts = registry?.hasInstallScripts ?? false;
  const typo = detectTyposquat(name, popular);

  const riskFlags: string[] = [];
  if (typo) riskFlags.push(`possible-typosquat-of:${typo.target}`);
  if (weeklyDownloads === null || weeklyDownloads === 0) riskFlags.push('zero-downloads');
  else if (weeklyDownloads < 1000) riskFlags.push('low-downloads');
  if (brandNew) riskFlags.push('published-within-7-days');
  if (registry?.maintainersCount === 1) riskFlags.push('single-maintainer');
  if (installScripts) riskFlags.push('runs-install-scripts');
  if (advisoryCount > 0) riskFlags.push('has-known-advisory');
  if (deprecated) riskFlags.push('deprecated');
  if (archived) riskFlags.push('archived');

  const risk = assessRisk({
    flags: riskFlags,
    hasCriticalOrHighAdvisory: hasCriticalOrHighAdvisory(advisories),
    typosquat: Boolean(typo),
    installScripts,
    brandNew,
    lowTrust,
    deprecatedOrArchived: deprecated || archived,
  });

  return {
    exists: true,
    tracked: wasTracked,
    deprecated,
    archived,
    latestVersion: registry?.latestVersion ?? row?.latestVersion ?? null,
    weeklyDownloads,
    riskFlags,
    risk,
    typosquatOf: typo?.target ?? null,
    confidence: (row?.confidence as Confidence) ?? null,
    advisoryCount,
  };
}
