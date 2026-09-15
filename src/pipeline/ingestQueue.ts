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
 * drains its own queue.
 *
 * Durable underneath: every request is also written to `discovery_queue` as a
 * `reactive` row, and the outcome is written back. The in-memory pool is the
 * fast path; if the process dies with work pending (every deploy), the hourly
 * worker ingests whatever is still pending instead of waiting for someone to
 * ask again.
 */
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { enqueueDemand, recordIngestFailure, setDiscoveryStatus } from '../db/discovery';
import type { PackageRow } from '../db/schema';
import { DISCOVERY } from '../scoring/weights';
import { syncOnePackage } from './single';

/** Write the request down before doing it. Best-effort: losing the durable
 *  copy only loses crash-recovery, never the ingest itself. */
async function persistDemand(db: Database, name: string, owner: string | null): Promise<void> {
  await enqueueDemand(db, name, owner).catch((err) =>
    logger.warn(`ingest queue: could not persist request for ${name}: ${String(err)}`),
  );
}

const MAX_CONCURRENT = 3;
const MAX_PENDING = 500;

const pending: string[] = [];
const inFlight = new Set<string>();
const queuedNames = new Set<string>();
/** First-requester ownerId per queued name (dashboard v1 phase 2 attribution).
 *  Dedup stays keyed by name, so the first enqueue's owner is the one credited. */
const owners = new Map<string, string | null>();
let active = 0;

/** Current backlog (pending + in-flight) — exposed for tests/observability. */
export function ingestQueueDepth(): number {
  return pending.length + inFlight.size;
}

/**
 * Wait for the backlog to clear.
 *
 * Only a ONE-SHOT process needs this. The queue's in-flight syncs hold the same
 * DB handle their caller opened, so a cron that returns from its command and
 * closes the pool pulls the floor out from under every ingest it just queued —
 * the nightly repo scan would discover hundreds of new dependencies and then
 * fail every one of them against a closed pool. The long-lived server never
 * calls this: there is nothing to wait for when the process outlives the work.
 *
 * Bounded, because a cron that cannot finish is worse than one that leaves work
 * for tomorrow. Whatever is still queued at the deadline is abandoned and the
 * next scan re-enqueues it — the same self-heal the queue already relies on for
 * a process that dies with work pending. Returns the count left behind.
 */
export async function drainIngestQueue(timeoutMs = 10 * 60_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (ingestQueueDepth() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return ingestQueueDepth();
}

/** Test-only: clear all queue state. */
export function resetIngestQueue(): void {
  pending.length = 0;
  inFlight.clear();
  queuedNames.clear();
  owners.clear();
  active = 0;
}

/**
 * Schedule an untracked-but-real package for background ingestion. No-op if it's
 * already pending or in-flight, or if the queue is at capacity. Returns without
 * awaiting any network/DB work.
 */
export function enqueueIngest(
  db: Database,
  name: string,
  requestedByOwnerId: string | null = null,
): void {
  if (queuedNames.has(name) || inFlight.has(name)) return;
  if (pending.length >= MAX_PENDING) {
    logger.warn(`ingest queue full (${MAX_PENDING}); dropping on-demand request for ${name}`);
    return;
  }
  queuedNames.add(name);
  owners.set(name, requestedByOwnerId);
  pending.push(name);
  void persistDemand(db, name, requestedByOwnerId);
  pump(db);
}

function pump(db: Database): void {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    const name = pending.shift()!;
    queuedNames.delete(name);
    const owner = owners.get(name) ?? null;
    owners.delete(name);
    inFlight.add(name);
    active += 1;
    void runIngest(db, name, owner).finally(() => {
      inFlight.delete(name);
      active -= 1;
      pump(db);
    });
  }
}

/**
 * Fetch→score→embed→upsert one package, recording the request and its outcome
 * in `discovery_queue`. Returns the stored row, or null on failure. Shared by the
 * background queue and the block-on-first-touch path (§4A) so both record the
 * same way.
 */
export async function runIngest(
  db: Database,
  name: string,
  requestedByOwnerId: string | null = null,
): Promise<PackageRow | null> {
  // The block-on-first-touch path calls this directly, so it records the request
  // too; for queued work it is a no-op upsert of the row enqueueIngest wrote.
  // Started, not awaited, so the ingest itself is not delayed behind a write —
  // but awaited before recording the outcome, or the upsert (which resets the
  // row to `pending`) could land after it and undo it.
  const persisted = persistDemand(db, name, requestedByOwnerId);
  try {
    const row = await syncOnePackage(db, name, { requestedByOwnerId });
    // Deliberately NOT added to `seed_packages`. It used to be, and nothing ever
    // removed an entry, so the list the daily sync re-fetches in full every run
    // only grew. An ingested package is kept fresh without it: the publish feed
    // re-syncs it the moment it releases, and the daily rotation refreshes the
    // stalest non-seed packages.
    await persisted;
    await setDiscoveryStatus(db, name, { status: 'ingested' }).catch(() => {});
    return row;
  } catch (err) {
    logger.warn(`on-demand ingest failed for ${name}: ${String(err)}`);
    // Counted against the same budget the worker uses, so a package whose
    // ingest keeps throwing retires instead of being retried every hour.
    await persisted;
    await recordIngestFailure(db, name, DISCOVERY.maxIngestAttempts).catch(() => {});
    return null;
  }
}
