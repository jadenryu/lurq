/**
 * Read/write helpers for publish alerts (`repo_alerts`).
 *
 * Same authorization rule as db/repos: every read is owner-scoped. The write is
 * not, because its caller is the registry watcher, which has no user context —
 * it derives the owner from the repo row it is writing against.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './client';
import { repoAlerts, type NewRepoAlertRow, type RepoAlertRow } from './schema';

/** Alerts returned to the dashboard feed in one page. */
export const ALERT_FEED_LIMIT = 50;

/**
 * Insert alerts, ignoring ones already recorded for the same repo + release.
 *
 * The conflict target is the dedup index, so a re-sync of an already-alerted
 * publish is a no-op rather than a duplicate row in someone's feed.
 */
export async function insertAlerts(
  db: Database,
  rows: NewRepoAlertRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(repoAlerts)
    .values(rows)
    .onConflictDoNothing({
      target: [repoAlerts.repoId, repoAlerts.packageName, repoAlerts.toVersion],
    })
    .returning({ id: repoAlerts.id });
  return inserted.length;
}

/** Newest first — the feed is "what happened to my dependencies lately". */
export async function listAlerts(
  db: Database,
  ownerId: string,
  limit = ALERT_FEED_LIMIT,
): Promise<RepoAlertRow[]> {
  return db
    .select()
    .from(repoAlerts)
    .where(eq(repoAlerts.ownerId, ownerId))
    .orderBy(desc(repoAlerts.createdAt))
    .limit(Math.min(limit, ALERT_FEED_LIMIT));
}

/**
 * Drop a repo's alerts. Called from `deleteRepo`: there is no foreign key (none
 * of the dashboard tables use one), so disconnecting a repo would otherwise
 * leave its alerts orphaned in the owner's feed pointing at a repo that is gone.
 */
export async function deleteAlertsForRepo(
  db: Database,
  ownerId: string,
  repoId: number,
): Promise<void> {
  await db
    .delete(repoAlerts)
    .where(and(eq(repoAlerts.ownerId, ownerId), eq(repoAlerts.repoId, repoId)));
}
