/**
 * In-process background ingester for on-demand misses (§12.5). Keeps the heavy
 * fetch→score→embed→upsert OFF the request path: evaluate/compare/verify enqueue
 * an untracked-but-real package and return immediately ("tracking, retry
 * shortly"), while a bounded worker pool ingests it within seconds.
 *
 * Bounded on purpose — moving unbounded work off the request path just relocates
 * the problem. Dedup (a package already pending or in-flight is never queued
 * again) + a hard pending cap mean a flood of distinct names can't spawn
 * unbounded syncs or grow memory without limit. Process-local; each instance
 * drains its own queue. Durability is by self-heal: if the process dies with
 * work pending, the next request for that package re-enqueues it.
 */
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { ensureSeedEntry } from '../db/packages';
import type { PackageRow } from '../db/schema';
import { syncOnePackage } from './single';

const MAX_CONCURRENT = 3;
const MAX_PENDING = 500;

const pending: string[] = [];
const inFlight = new Set<string>();
const queuedNames = new Set<string>();
let active = 0;

/** Current backlog (pending + in-flight) — exposed for tests/observability. */
export function ingestQueueDepth(): number {
  return pending.length + inFlight.size;
}

/** Test-only: clear all queue state. */
export function resetIngestQueue(): void {
  pending.length = 0;
  inFlight.clear();
  queuedNames.clear();
  active = 0;
}

/**
 * Schedule an untracked-but-real package for background ingestion. No-op if it's
 * already pending or in-flight, or if the queue is at capacity. Returns without
 * awaiting any network/DB work.
 */
export function enqueueIngest(db: Database, name: string): void {
  if (queuedNames.has(name) || inFlight.has(name)) return;
  if (pending.length >= MAX_PENDING) {
    logger.warn(`ingest queue full (${MAX_PENDING}); dropping on-demand request for ${name}`);
    return;
  }
  queuedNames.add(name);
  pending.push(name);
  pump(db);
}

function pump(db: Database): void {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    const name = pending.shift()!;
    queuedNames.delete(name);
    inFlight.add(name);
    active += 1;
    void runIngest(db, name).finally(() => {
      inFlight.delete(name);
      active -= 1;
      pump(db);
    });
  }
}

/**
 * Fetch→score→embed→upsert one package and, if it clears the roster-promotion
 * bar, seed it for future syncs. Returns the stored row, or null on failure.
 * Shared by the background queue and the block-on-first-touch path (§4A) so both
 * apply the same promotion rule.
 */
export async function runIngest(db: Database, name: string): Promise<PackageRow | null> {
  try {
    const row = await syncOnePackage(db, name);
    // Same roster-promotion bar as the old inline path: only genuinely-trackable
    // discoveries join the sync roster, so the on-demand tail can't inflate cost.
    if (row.confidence && row.confidence !== 'unproven') {
      await ensureSeedEntry(db, name, row.category).catch(() => {});
    }
    return row;
  } catch (err) {
    logger.warn(`on-demand ingest failed for ${name}: ${String(err)}`);
    return null;
  }
}
