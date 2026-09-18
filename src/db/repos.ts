/**
 * Read/write helpers for connected repositories.
 *
 * Every query is scoped by `ownerId`. That is the authorization boundary: the
 * HTTP layer authenticates the web app with the issuer secret and passes the
 * signed-in user's id, so a missing `ownerId` filter here would hand one user
 * another user's repos. There is deliberately no "get by id" without an owner.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client';
import { deleteAlertsForRepo } from './alerts';
import { repoPolicyDefaults, repos, type RepoRow } from './schema';
import { DEFAULT_REPO_POLICY, type RepoDrift, type RepoManifest, type RepoPolicy } from '../github/types';

export interface RepoUpsert {
  ownerId: string;
  installationId: number;
  fullName: string;
  defaultBranch: string | null;
  isPrivate: boolean;
}

/**
 * Register repos discovered from an installation.
 *
 * Idempotent, and deliberately does NOT touch `policy`, `drift`, or the scan
 * bookkeeping: re-running the connect flow (or GitHub replaying an installation
 * webhook) must never silently disarm a repo the user already configured.
 */
export async function upsertRepos(
  db: Database,
  rows: RepoUpsert[],
  /** The owner's default, for rows this call creates. Existing rows keep theirs. */
  policy: RepoPolicy = DEFAULT_REPO_POLICY,
): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insert(repos)
    .values(
      rows.map((row) => ({
        ownerId: row.ownerId,
        installationId: row.installationId,
        fullName: row.fullName,
        defaultBranch: row.defaultBranch,
        isPrivate: row.isPrivate,
        policy,
      })),
    )
    .onConflictDoUpdate({
      target: [repos.ownerId, repos.fullName],
      set: {
        installationId: sql`excluded.installation_id`,
        defaultBranch: sql`excluded.default_branch`,
        isPrivate: sql`excluded.is_private`,
      },
    });
  return rows.length;
}

export async function listRepos(db: Database, ownerId: string): Promise<RepoRow[]> {
  return db
    .select()
    .from(repos)
    .where(eq(repos.ownerId, ownerId))
    .orderBy(repos.fullName);
}

/**
 * Every connected repo, all owners. The one deliberately unscoped read — it
 * backs the nightly cron, which has no user context. Never reachable from an
 * HTTP route.
 */
export async function listAllRepos(db: Database): Promise<RepoRow[]> {
  return db.select().from(repos).orderBy(repos.installationId, repos.fullName);
}

/**
 * Every connected repo whose stored manifests declare `name`, across all owners.
 *
 * The other deliberately unscoped read (see `listAllRepos`): its caller is the
 * registry watcher reacting to a publish, which has no user context. Never
 * reachable from an HTTP route.
 *
 * `jsonb_exists` rather than the `?` operator: the function form is identical in
 * Postgres and does not collide with the driver's parameter placeholders. Only
 * scanned repos can match, since `manifests` is null until the first scan — an
 * unscanned repo has no declared set to compare against, which is correct.
 */
export async function reposDeclaring(db: Database, name: string): Promise<RepoRow[]> {
  return db
    .select()
    .from(repos)
    .where(
      sql`exists (
        select 1 from jsonb_array_elements(${repos.manifests}) as m
        where jsonb_exists(m -> 'deps', ${name})
      )`,
    );
}

/**
 * The lurq user an installation belongs to, or null when nothing links them.
 *
 * The third deliberately unscoped read, and the one that makes webhooks work:
 * GitHub tells us an installation id, never a Clerk user, so the existing rows
 * are the only mapping back to an owner. Unscoped by necessity — the caller has
 * no user context to scope by, and it returns an owner rather than any repo data.
 *
 * ponytail: the mapping lives in `repos`, so removing every repo from an
 * installation also forgets who owns it, and later webhook additions are ignored
 * until the user clicks "Add repositories" again. Give installations their own
 * table if that stops being an acceptable edge.
 */
export async function ownerForInstallation(
  db: Database,
  installationId: number,
): Promise<string | null> {
  const rows = await db
    .select({ ownerId: repos.ownerId })
    .from(repos)
    .where(eq(repos.installationId, installationId))
    .limit(1);
  return rows[0]?.ownerId ?? null;
}

/**
 * Forget repos reachable through an installation — all of them, or just the
 * named ones. Returns how many rows went away.
 *
 * Routes every deletion through `deleteRepo` rather than issuing one bulk
 * `delete`: alerts carry no foreign key, and a bulk delete here would strand
 * them in the owner's feed pointing at rows that no longer exist.
 */
export async function deleteReposByInstallation(
  db: Database,
  installationId: number,
  fullNames?: string[],
): Promise<number> {
  const only = fullNames ? new Set(fullNames) : null;
  const rows = await db
    .select({ id: repos.id, ownerId: repos.ownerId, fullName: repos.fullName })
    .from(repos)
    .where(eq(repos.installationId, installationId));
  let deleted = 0;
  for (const row of rows) {
    if (only && !only.has(row.fullName)) continue;
    if (await deleteRepo(db, row.ownerId, row.id)) deleted++;
  }
  return deleted;
}

export async function getRepo(
  db: Database,
  ownerId: string,
  id: number,
): Promise<RepoRow | null> {
  const rows = await db
    .select()
    .from(repos)
    .where(and(eq(repos.ownerId, ownerId), eq(repos.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The policy governing `owner/name`, or null when this owner has not connected
 * that repo.
 *
 * Null is a first-class answer, not a failure: `upgrade-plan` runs in any
 * checkout, connected or not, and an unconnected one is simply ungoverned. The
 * caller must not substitute `DEFAULT_REPO_POLICY` here — that default has
 * `scope: 'blocking'`, so treating "not connected" as "default policy" would
 * silently narrow every unconnected workflow on deploy.
 */
export async function findPolicyByFullName(
  db: Database,
  ownerId: string,
  fullName: string,
): Promise<RepoPolicy | null> {
  const rows = await db
    .select({ policy: repos.policy })
    .from(repos)
    .where(and(eq(repos.ownerId, ownerId), eq(repos.fullName, fullName)))
    .limit(1);
  return rows[0]?.policy ?? null;
}

/** Persist a successful scan. Clears `lastScanError` — see the schema comment. */
export async function saveScan(
  db: Database,
  id: number,
  scan: { manifests: RepoManifest[]; drift: RepoDrift; installCommand: string },
): Promise<void> {
  await db
    .update(repos)
    .set({
      manifests: scan.manifests,
      drift: scan.drift,
      installCommand: scan.installCommand,
      lastScanAt: new Date(),
      lastScanError: null,
    })
    .where(eq(repos.id, id));
}

/**
 * Record a failed scan without discarding the last good drift numbers. Stale
 * data plus a visible error beats an empty table: the user can still see what
 * their repo looked like at the last successful read.
 */
export async function saveScanError(
  db: Database,
  id: number,
  message: string,
): Promise<void> {
  await db
    .update(repos)
    .set({ lastScanAt: new Date(), lastScanError: message.slice(0, 500) })
    .where(eq(repos.id, id));
}

export async function setRepoPolicy(
  db: Database,
  ownerId: string,
  id: number,
  policy: RepoPolicy,
): Promise<boolean> {
  const updated = await db
    .update(repos)
    .set({ policy })
    .where(and(eq(repos.ownerId, ownerId), eq(repos.id, id)))
    .returning({ id: repos.id });
  return updated.length > 0;
}

/** Forget a repo. The GitHub App install itself is revoked on GitHub, not here. */
export async function deleteRepo(
  db: Database,
  ownerId: string,
  id: number,
): Promise<boolean> {
  // Alerts first: they carry no foreign key, so leaving them would strand rows
  // in the owner's feed naming a repo that no longer exists.
  await deleteAlertsForRepo(db, ownerId, id);
  const deleted = await db
    .delete(repos)
    .where(and(eq(repos.ownerId, ownerId), eq(repos.id, id)))
    .returning({ id: repos.id });
  return deleted.length > 0;
}

/**
 * The owner's default autopilot policy, or null when they have never set one.
 *
 * Null rather than DEFAULT_REPO_POLICY so a caller can tell "never configured"
 * from "configured to look like the default" — the panel needs that distinction
 * to say whether new repos arrive armed.
 */
export async function getRepoPolicyDefault(
  db: Database,
  ownerId: string,
): Promise<RepoPolicy | null> {
  const [row] = await db
    .select({ policy: repoPolicyDefaults.policy })
    .from(repoPolicyDefaults)
    .where(eq(repoPolicyDefaults.ownerId, ownerId))
    .limit(1);
  return row?.policy ?? null;
}

export async function setRepoPolicyDefault(
  db: Database,
  ownerId: string,
  policy: RepoPolicy,
): Promise<void> {
  await db
    .insert(repoPolicyDefaults)
    .values({ ownerId, policy })
    .onConflictDoUpdate({
      target: repoPolicyDefaults.ownerId,
      set: { policy, updatedAt: new Date() },
    });
}

/**
 * Stamp one policy onto the named repos. Returns how many rows it reached.
 *
 * A stamp, not a subscription: a repo edited after this keeps its own settings
 * until the owner stamps again. See the table comment for why inheritance is
 * deliberately not modelled.
 *
 * `ownerId` is still in the WHERE even though ids are explicit — ids arrive from
 * a request body, so filtering on them alone would let one account stamp a
 * policy onto another account's repos by guessing integers.
 */
export async function applyPolicyToRepos(
  db: Database,
  ownerId: string,
  ids: number[],
  policy: RepoPolicy,
): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await db
    .update(repos)
    .set({ policy })
    .where(and(eq(repos.ownerId, ownerId), inArray(repos.id, ids)))
    .returning({ id: repos.id });
  return updated.length;
}
