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
import { listAllRepos, listRepos, saveScan, saveScanError } from '../db/repos';
import type { RepoRow } from '../db/schema';
import { GithubAppError } from '../github/app';
import { computeDrift } from '../github/drift';
import { fetchManifests } from '../github/manifests';

export interface ScanResult {
  repoId: number;
  fullName: string;
  ok: boolean;
  depsTracked: number;
  majorDrift: number;
  partial: boolean;
  error?: string;
}

/** Scan one repo. Never throws — failures land in `lastScanError`. */
export async function scanRepo(db: Database, repo: RepoRow): Promise<ScanResult> {
  const base = { repoId: repo.id, fullName: repo.fullName };
  try {
    const branch = repo.defaultBranch ?? 'main';
    const { manifests, partial } = await fetchManifests(
      repo.installationId,
      repo.fullName,
      branch,
    );
    const drift = await computeDrift(db, manifests);
    await saveScan(db, repo.id, { manifests, drift });
    return {
      ...base,
      ok: true,
      depsTracked: drift.depsTracked,
      majorDrift: drift.majorDrift,
      partial,
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
    return { ...base, ok: false, depsTracked: 0, majorDrift: 0, partial: false, error: message };
  }
}

/** Sequential on purpose: GitHub's rate limit is per installation and shared
 *  across these calls, and a scan is a background job with nobody waiting on
 *  latency. Parallelism here buys seconds and costs 403s. */
async function scanEach(db: Database, rows: RepoRow[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const repo of rows) {
    results.push(await scanRepo(db, repo));
  }
  return results;
}

/** Scan every repo an owner has connected. */
export async function scanOwnerRepos(
  db: Database,
  ownerId: string,
): Promise<ScanResult[]> {
  return scanEach(db, await listRepos(db, ownerId));
}

/** Scan every connected repo across all owners — the daily cron entry point. */
export async function scanAllRepos(db: Database): Promise<ScanResult[]> {
  return scanEach(db, await listAllRepos(db));
}
