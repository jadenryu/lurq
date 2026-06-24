/**
 * MCP tool handlers (§12.3). Pure functions over a Database — the transport
 * layer (server.ts) just wires zod schemas to these. Responses are kept compact
 * (§12.4): summaries truncated, advisories capped, no raw payloads, always a
 * `dataAsOf` and a `stale` hint when data is old (§17).
 */
import { sql } from 'drizzle-orm';
import { STALENESS_DAYS } from '../core/constants';
import type {
  Advisory,
  AdvisorySeverity,
  Category,
  Confidence,
  EvaluateOutput,
  VerifyOutput,
} from '../core/types';
import type { Database } from '../db/client';
import { packages, type PackageRow } from '../db/schema';
import { fetchNpmRegistry, npmPackageExists } from '../ingestion/sources';
import { truncateSentences } from '../ingestion/summarize';
import { getOrFetchPackage } from '../pipeline/single';
import { recommend, type RecommendOptions } from '../search/recommend';

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

async function latestDataAsOf(db: Database): Promise<string> {
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

export async function handleRecommend(db: Database, input: RecommendInput) {
  const candidates = await recommend(db, {
    need: input.need,
    category: input.category,
    constraints: input.constraints,
    limit: 5,
  });
  return { dataAsOf: await latestDataAsOf(db), candidates };
}

// ── evaluate ────────────────────────────────────────────────────────────────

export async function handleEvaluate(
  db: Database,
  input: { package: string },
): Promise<EvaluateOutput | { tracked: false; suggestion: string }> {
  const { row, existsOnNpm } = await getOrFetchPackage(db, input.package);
  if (!row) {
    return {
      tracked: false,
      suggestion: existsOnNpm
        ? `"${input.package}" exists on npm but could not be scored right now; try again.`
        : `"${input.package}" was not found on the npm registry. Check the package name.`,
    };
  }
  return rowToEvaluate(row);
}

// ── compare ─────────────────────────────────────────────────────────────────

export async function handleCompare(db: Database, input: { packages: string[] }) {
  const results = await Promise.all(input.packages.map((name) => getOrFetchPackage(db, name)));
  const rows = results
    .map((r) => r.row)
    .filter((row): row is PackageRow => row !== null)
    .map(rowToEvaluate)
    .sort((a, b) => b.healthScore - a.healthScore);
  const missing = input.packages.filter(
    (name) => !rows.some((r) => r.name === name),
  );
  return { dataAsOf: await latestDataAsOf(db), rows, ...(missing.length ? { missing } : {}) };
}

// ── verify ──────────────────────────────────────────────────────────────────

export async function handleVerify(
  db: Database,
  input: { package: string },
): Promise<VerifyOutput> {
  const name = input.package;
  const exists = await npmPackageExists(name);
  if (!exists) {
    return {
      exists: false,
      tracked: false,
      deprecated: false,
      archived: false,
      latestVersion: null,
      weeklyDownloads: null,
      riskFlags: ['not-found-on-registry'],
      confidence: null,
      advisoryCount: 0,
    };
  }

  const registry = await fetchNpmRegistry(name).catch(() => null);
  const { row, wasTracked } = await getOrFetchPackage(db, name);

  const weeklyDownloads = row?.weeklyDownloads ?? null;
  const advisoryCount = row?.advisories?.length ?? 0;
  const deprecated = Boolean(row?.deprecated || registry?.deprecated);
  const archived = Boolean(row?.archived);

  const riskFlags: string[] = [];
  if (weeklyDownloads === null || weeklyDownloads === 0) riskFlags.push('zero-downloads');
  else if (weeklyDownloads < 1000) riskFlags.push('low-downloads');
  if (withinDays(registry?.firstPublishedAt ?? null, 7)) riskFlags.push('published-within-7-days');
  if (registry?.maintainersCount === 1) riskFlags.push('single-maintainer');
  if (advisoryCount > 0) riskFlags.push('has-known-advisory');
  if (deprecated) riskFlags.push('deprecated');
  if (archived) riskFlags.push('archived');

  return {
    exists: true,
    tracked: wasTracked,
    deprecated,
    archived,
    latestVersion: registry?.latestVersion ?? row?.latestVersion ?? null,
    weeklyDownloads,
    riskFlags,
    confidence: (row?.confidence as Confidence) ?? null,
    advisoryCount,
  };
}
