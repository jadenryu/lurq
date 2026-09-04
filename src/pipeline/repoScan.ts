/**
 * Repo scan: read manifests from GitHub, compute drift against the index, store
 * the summary.
 *
 * Runs on connect, on demand from the dashboard, and once a day from the sync
 * cron. Scans are independent per repo and a failure is recorded rather than
 * thrown, so one archived or permission-revoked repository cannot stop the
 * nightly pass for everything else the user connected.
 *
 * Cost note: a scan is 1 tree call + N content calls per repo, no clone and no
 * npm traffic — the version data it diffs against is already in our own index.
 */
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { listAllRepos, saveScan, saveScanError } from '../db/repos';
import type { RepoRow } from '../db/schema';
import { GithubAppError } from '../github/app';
import { computeDrift } from '../github/drift';
import { fetchManifests, type InstallationRepo } from '../github/manifests';
import { fetchResolvedTree } from '../github/sbom';

export interface ScanResult {
  repoId: number;
  fullName: string;
  ok: boolean;
  depsTracked: number;
  majorDrift: number;
  partial: boolean;
  /** False when the repo has no dependency graph, so transitives were not read. */
  transitivesRead: boolean;
  /** The repository has no commits yet. A successful scan of nothing. */
  empty: boolean;
  error?: string;
}

/** Scan one repo. Never throws — failures land in `lastScanError`. */
export async function scanRepo(db: Database, repo: RepoRow): Promise<ScanResult> {
  const base = { repoId: repo.id, fullName: repo.fullName };
  try {
    const branch = repo.defaultBranch ?? 'main';
    const { manifests, installCommand, partial, empty } = await fetchManifests(
      repo.installationId,
      repo.fullName,
      branch,
    );
    // The resolved tree is where most advisories actually live, but it depends
    // on a repo feature that may be off. A null result degrades to
    // direct-dependency-only drift rather than failing the scan.
    const resolvedTree = await fetchResolvedTree(repo.installationId, repo.fullName);
    // ownerId is passed so any dependency this scan ingests for the first time
    // is attributed to the user whose repo surfaced it.
    const drift = await computeDrift(db, manifests, resolvedTree, repo.ownerId);
    await saveScan(db, repo.id, { manifests, drift, installCommand });
    return {
      ...base,
      ok: true,
      depsTracked: drift.depsTracked,
      majorDrift: drift.majorDrift,
      partial,
      transitivesRead: resolvedTree !== null,
      empty,
    };
  } catch (err) {
    // A revoked installation is the common case and deserves an actionable
    // message rather than a raw HTTP status the user can do nothing with.
    const message =
      err instanceof GithubAppError && err.status === 404
        ? 'GitHub access was revoked for this repo. Reconnect the lurq app.'
        : err instanceof Error
          ? err.message
          : 'Scan failed.';
    logger.warn(`repo scan failed for ${repo.fullName}: ${message}`);
    await saveScanError(db, repo.id, message).catch(() => {
      /* the scan already failed; a bookkeeping write failure must not mask it */
    });
    return {
      ...base,
      ok: false,
      depsTracked: 0,
      majorDrift: 0,
      partial: false,
      transitivesRead: false,
      empty: false,
      error: message,
    };
  }
}

/** Sequential on purpose: GitHub's rate limit is per installation and shared
 *  across these calls, and a scan is a background job with nobody waiting on
 *  latency. Parallelism here buys seconds and costs 403s. */
export async function scanRepos(db: Database, rows: RepoRow[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const repo of rows) {
    results.push(await scanRepo(db, repo));
  }
  return results;
}

/**
 * Rows reordered most-recently-pushed first, using the inventory just read from
 * GitHub (`pushed_at` is not stored — it is only ever an ordering hint).
 *
 * This matters because `scanRepos` is sequential: on a 40-repo install the order
 * decides which row in a dashboard someone is actively watching stops saying
 * "scanning…" first. Alphabetical made that a coin flip; the repo they pushed to
 * this morning is the one they connected lurq for. Rows absent from the
 * inventory keep their incoming order at the end (`Array#sort` is stable).
 */
export function byRecentPush(rows: RepoRow[], inventory: InstallationRepo[]): RepoRow[] {
  const pushedAt = (repo: InstallationRepo): number => {
    const parsed = Date.parse(repo.pushedAt ?? '');
    // NaN would make the comparator inconsistent and the sort order arbitrary;
    // a repo with no timestamp sorts as oldest instead.
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const rank = new Map(
    [...inventory]
      .sort((a, b) => pushedAt(b) - pushedAt(a))
      .map((repo, index) => [repo.fullName, index] as const),
  );
  return [...rows].sort(
    (a, b) =>
      (rank.get(a.fullName) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.fullName) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Scan every connected repo across all owners — the daily cron entry point. */
export async function scanAllRepos(db: Database): Promise<ScanResult[]> {
  return scanRepos(db, await listAllRepos(db));
}
