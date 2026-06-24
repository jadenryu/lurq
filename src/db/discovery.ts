/**
 * Read/write helpers for the `discovery_queue` table (§2B). The crawler enqueues
 * candidates here; the merit gate pre-scores and graduates them.
 */
import { eq, inArray, sql } from 'drizzle-orm';
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

export async function getPendingCandidates(
  db: Database,
  limit: number,
): Promise<DiscoveryQueueRow[]> {
  return db
    .select()
    .from(discoveryQueue)
    .where(eq(discoveryQueue.status, 'pending'))
    .limit(limit);
}

export async function setDiscoveryStatus(
  db: Database,
  name: string,
  data: { status: DiscoveryStatus; preScore?: number | null },
): Promise<void> {
  await db
    .update(discoveryQueue)
    .set({ status: data.status, ...(data.preScore !== undefined ? { preScore: data.preScore } : {}) })
    .where(eq(discoveryQueue.name, name));
}

/** Bulk-mark a set of names rejected (used when the per-run cap drops the tail). */
export async function rejectNames(db: Database, names: string[]): Promise<void> {
  if (names.length === 0) return;
  await db
    .update(discoveryQueue)
    .set({ status: 'rejected' })
    .where(inArray(discoveryQueue.name, names));
}

export async function countByStatus(db: Database): Promise<Record<DiscoveryStatus, number>> {
  const rows = await db
    .select({ status: discoveryQueue.status, n: sql<number>`count(*)::int` })
    .from(discoveryQueue)
    .groupBy(discoveryQueue.status);
  const out: Record<DiscoveryStatus, number> = { pending: 0, ingested: 0, rejected: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}
