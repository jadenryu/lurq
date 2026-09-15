/**
 * Read/write helpers for the `discovery_queue` table (§2B). The crawler enqueues
 * candidates here; the merit gate pre-scores and graduates them.
 */
import { eq, sql } from 'drizzle-orm';
import type { DiscoverySource, DiscoveryStatus } from '../core/types';
import type { Database } from './client';
import { discoveryQueue, packages, type DiscoveryQueueRow } from './schema';

export interface DiscoveryCandidate {
  name: string;
  via: DiscoverySource;
}

/** Names already tracked (in `packages`) or already queued — never re-enqueue. */
export async function getKnownNames(db: Database): Promise<Set<string>> {
  const [tracked, queued] = await Promise.all([
    db.select({ name: packages.name }).from(packages),
    db.select({ name: discoveryQueue.name }).from(discoveryQueue),
  ]);
  return new Set([...tracked.map((r) => r.name), ...queued.map((r) => r.name)]);
}

/** Names already sitting in the queue, at any status. The changes-feed follower
 *  keeps this in memory so a package republishing twenty times in an hour costs
 *  one insert attempt, not twenty — `onConflictDoNothing` would swallow the rest,
 *  but each rejected row still burns a sequence value and an index probe. */
export async function getQueuedNames(db: Database): Promise<Set<string>> {
  const rows = await db.select({ name: discoveryQueue.name }).from(discoveryQueue);
  return new Set(rows.map((r) => r.name));
}

/** Insert new candidates, ignoring any that race in concurrently. Returns count inserted. */
export async function enqueueCandidates(
  db: Database,
  candidates: DiscoveryCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;
  const rows = candidates.map((c) => ({ name: c.name, discoveredVia: c.via }));
  const inserted = await db
    .insert(discoveryQueue)
    .values(rows)
    .onConflictDoNothing({ target: discoveryQueue.name })
    .returning({ id: discoveryQueue.id });
  return inserted.length;
}

/**
 * Durably record that a query asked for an untracked package by name.
 *
 * The API process ingests these itself within seconds; this row is what makes
 * the request survive a deploy or crash in between, because the hourly worker
 * drains any `reactive` row still pending. An upsert, not an insert: a name the
 * merit gate once rejected is still worth ingesting when a user asks for it,
 * which is what the in-process path always did. A `failed` row stays failed so
 * a package whose ingest keeps throwing is not re-bought every hour.
 */
export async function enqueueDemand(
  db: Database,
  name: string,
  requestedByOwnerId: string | null,
): Promise<void> {
  await db
    .insert(discoveryQueue)
    .values({ name, discoveredVia: 'reactive', requestedByOwnerId })
    .onConflictDoUpdate({
      target: discoveryQueue.name,
      set: {
        discoveredVia: 'reactive',
        status: sql`case when ${discoveryQueue.status} = 'failed' then 'failed' else 'pending' end`,
        requestedByOwnerId: sql`coalesce(${discoveryQueue.requestedByOwnerId}, excluded.requested_by_owner_id)`,
      },
    });
}

/** Pending candidates, user-requested (`reactive`) first so a busy crawl never
 *  pushes someone's explicit request past the per-run cap. */
export async function getPendingCandidates(
  db: Database,
  limit: number,
): Promise<DiscoveryQueueRow[]> {
  return db
    .select()
    .from(discoveryQueue)
    .where(eq(discoveryQueue.status, 'pending'))
    .orderBy(sql`${discoveryQueue.discoveredVia} = 'reactive' desc`, discoveryQueue.discoveredAt)
    .limit(limit);
}

/**
 * Record a failed ingest attempt, retiring the candidate once it has spent its
 * budget. Returns the new attempt count.
 *
 * Done as one statement so the increment and the retirement decision see the
 * same value: reading `attempts`, adding one in JS and writing it back would let
 * two concurrent cycles both read 2, both write 3, and leave a candidate that
 * has now failed four times still pending.
 */
export async function recordIngestFailure(
  db: Database,
  name: string,
  maxAttempts: number,
): Promise<number> {
  const [row] = await db
    .update(discoveryQueue)
    .set({
      attempts: sql`${discoveryQueue.attempts} + 1`,
      status: sql`case when ${discoveryQueue.attempts} + 1 >= ${maxAttempts} then 'failed' else ${discoveryQueue.status} end`,
    })
    .where(eq(discoveryQueue.name, name))
    .returning({ attempts: discoveryQueue.attempts });
  return row?.attempts ?? 0;
}

export async function setDiscoveryStatus(
  db: Database,
  name: string,
  data: { status: DiscoveryStatus; preScore?: number | null },
): Promise<void> {
  await db
    .update(discoveryQueue)
    .set({
      status: data.status,
      ...(data.preScore !== undefined ? { preScore: data.preScore } : {}),
    })
    .where(eq(discoveryQueue.name, name));
}
