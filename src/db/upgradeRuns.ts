/**
 * Read/write helpers for `upgrade_runs`.
 *
 * Writes come from users' CI through an API key, so `ownerId` is always resolved
 * from the authenticated key and never read off the request body. Reads are
 * owner-scoped for the same reason as `db/repos.ts`.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from './client';
import { repos, upgradeRuns, type NewUpgradeRunRow, type UpgradeRunRow } from './schema';

/** Cap on a single CI post. A run that proposes more than this is misconfigured,
 *  not ambitious, and the limit keeps one request from writing unbounded rows. */
export const MAX_RUNS_PER_POST = 100;

/**
 * Insert or refresh the rows for one Actions run.
 *
 * Upserts on the dedup key so a retried job updates its rows in place. Without
 * that, re-running a failed workflow would double every figure the impact view
 * reports — the most likely way for these numbers to quietly become wrong.
 */
export async function recordUpgradeRuns(
  db: Database,
  rows: NewUpgradeRunRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(upgradeRuns)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        upgradeRuns.ownerId,
        upgradeRuns.repoFullName,
        upgradeRuns.packageName,
        upgradeRuns.toVersion,
        upgradeRuns.runUrl,
      ],
      set: {
        severity: sql`excluded.severity`,
        status: sql`excluded.status`,
        symbolsAffected: sql`excluded.symbols_affected`,
        callSites: sql`excluded.call_sites`,
        callSiteFiles: sql`excluded.call_site_files`,
        filesChanged: sql`excluded.files_changed`,
        testsPassed: sql`excluded.tests_passed`,
        prUrl: sql`excluded.pr_url`,
        repoId: sql`excluded.repo_id`,
      },
    });
  return rows.length;
}

/** Resolve `owner/name` to a connected repo id, or null when it isn't connected. */
export async function findRepoIdByFullName(
  db: Database,
  ownerId: string,
  fullName: string,
): Promise<number | null> {
  const rows = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.ownerId, ownerId), eq(repos.fullName, fullName)))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function listRunsForRepo(
  db: Database,
  ownerId: string,
  repoId: number,
  limit = 50,
): Promise<UpgradeRunRow[]> {
  return db
    .select()
    .from(upgradeRuns)
    .where(and(eq(upgradeRuns.ownerId, ownerId), eq(upgradeRuns.repoId, repoId)))
    .orderBy(desc(upgradeRuns.createdAt))
    .limit(limit);
}

/**
 * Per-repo upkeep activity for one owner.
 *
 * `getUpgradeImpact` answers "how much has lurq caught for me" across an
 * account. This answers a different question the dashboard cannot currently
 * ask: for THIS repository, has the workflow ever actually run? A repo can be
 * armed in the database with the workflow never committed — `policy.enabled`
 * true, zero runs — and today it is indistinguishable from one opening pull
 * requests every week.
 *
 * Keyed on `repoFullName`, never `repoId`: that column is nullable for runs
 * from a repository lurq has no GitHub App installation on, and the schema
 * comment above it says losing those would bias every impact figure. The same
 * reasoning applies here — a repo running the workflow without the App
 * installed is exactly the case worth seeing.
 *
 * Facts only, deliberately no verdict. Absence of runs does NOT mean the
 * workflow is missing: a repo with nothing behind reports nothing, so "never
 * ran" is ambiguous with "nothing to do". The useful inference — armed, still
 * behind, and never reported — needs drift, which belongs to the caller.
 */
export interface RepoUpkeep {
  /** `owner/name`, as the workflow reports it from GITHUB_REPOSITORY. */
  repoFullName: string;
  /** Most recent reported run, all time. Null is impossible here: a row exists. */
  lastRunAt: Date;
  /** Rows recorded, deduped to one per package per target per run by the schema. */
  runs: number;
  /** Runs that reached a pull request — the only evidence upkeep is landing. */
  delivered: number;
  /** Runs the workflow reported as failed, which a green armed badge hides. */
  failed: number;
}

/**
 * One row per repository that has ever reported a run, for one owner.
 *
 * Returned as a Map so a caller joining this onto a repo list does one query
 * and one lookup per repo, rather than a query per repo.
 */
export async function upkeepByRepo(
  db: Database,
  ownerId: string,
): Promise<Map<string, RepoUpkeep>> {
  const rows = await db
    .select({
      repoFullName: upgradeRuns.repoFullName,
      lastRunAt: sql<Date>`max(${upgradeRuns.createdAt})`,
      runs: sql<number>`count(*)::int`,
      delivered: sql<number>`count(*) filter (where ${upgradeRuns.status} in ('pr_open','merged'))::int`,
      failed: sql<number>`count(*) filter (where ${upgradeRuns.status} = 'failed')::int`,
    })
    .from(upgradeRuns)
    .where(eq(upgradeRuns.ownerId, ownerId))
    .groupBy(upgradeRuns.repoFullName);

  return new Map(rows.map((r) => [r.repoFullName, { ...r, lastRunAt: new Date(r.lastRunAt) }]));
}

export interface UpgradeImpact {
  /** Upgrades analysed in the window. */
  analysed: number;
  /** Upgrades where a referenced symbol disappears — caught before merge. */
  blocking: number;
  /** Referenced call sites those upgrades would have broken. */
  callSites: number;
  prsOpened: number;
  merged: number;
  /** Analysed but not conclusively checked. Reported, never folded into "clean". */
  unverified: number;
}

/**
 * Impact totals for the dashboard.
 *
 * One aggregate query rather than pulling rows and reducing in JS: this is the
 * figure on the overview, and it should stay O(1) work for the web tier no
 * matter how many runs an account accumulates.
 */
export async function getUpgradeImpact(
  db: Database,
  ownerId: string,
  days = 30,
): Promise<UpgradeImpact> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      analysed: sql<number>`count(*)::int`,
      blocking: sql<number>`count(*) filter (where ${upgradeRuns.severity} = 'blocking')::int`,
      callSites: sql<number>`coalesce(sum(${upgradeRuns.callSites}) filter (where ${upgradeRuns.severity} = 'blocking'), 0)::int`,
      prsOpened: sql<number>`count(*) filter (where ${upgradeRuns.status} in ('pr_open','merged'))::int`,
      merged: sql<number>`count(*) filter (where ${upgradeRuns.status} = 'merged')::int`,
      unverified: sql<number>`count(*) filter (where ${upgradeRuns.severity} = 'unverified')::int`,
    })
    .from(upgradeRuns)
    .where(and(eq(upgradeRuns.ownerId, ownerId), gte(upgradeRuns.createdAt, since)));

  return (
    rows[0] ?? {
      analysed: 0,
      blocking: 0,
      callSites: 0,
      prsOpened: 0,
      merged: 0,
      unverified: 0,
    }
  );
}
