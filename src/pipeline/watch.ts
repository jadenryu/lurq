/**
 * npm `_changes` follower — the streaming log.
 *
 * Two jobs, one stream:
 *
 *  1. A *tracked* package publishes → re-sync it, so scores, advisories and the
 *     version timeline stay fresh without a full crawl.
 *  2. An *unknown* name appears → queue it as a discovery candidate.
 *
 * (2) is the only growth channel that scales. The other two are bounded by
 * construction: `graphChannel` can only reach packages adjacent to ones we
 * already have, and `searchChannel` can only reach what npm's ranking will
 * paginate. Both had run dry — the discovery queue was sitting at zero pending
 * while the crawler had capacity for ~9,600 ingests a day. This feed is npm
 * telling us about every publish as it happens, and the follower used to drop
 * every unrecognised name on the floor.
 *
 * Candidates are only *queued* here, never ingested: the §2B merit gate still
 * pre-scores each one on quality signals and rejects the vast majority. The feed
 * supplies volume; the gate keeps the index honest.
 *
 * Resumable via a persisted sequence cursor (db/watch), so a restart picks up
 * where it left off instead of replaying the registry. Long-running: an operator
 * runs `lurq watch` as a daemon, matching lurq's external-scheduler model.
 */
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { enqueueCandidates, getQueuedNames } from '../db/discovery';
import { getAllPackageNames } from '../db/packages';
import { getWatchCursor, setWatchCursor } from '../db/watch';
import { syncOnePackage } from './single';

const FEED_ID = 'npm-changes';
const FEED_URL = 'https://replicate.npmjs.com/_changes';
const HEARTBEAT_MS = 30_000;
const TRACKED_REFRESH_MS = 5 * 60_000; // re-read the tracked set this often
const CHECKPOINT_EVERY = 200; // advance the cursor through churn at least this often
const MAX_BACKOFF_MS = 30_000;
/** Buffered new names flushed per insert. The feed is a firehose and one row per
 *  change would be one round-trip per publish; batching makes it one per 200. */
const ENQUEUE_BATCH = 200;

export interface ChangeRecord {
  seq: number | string;
  id: string;
  deleted: boolean;
}

/** Parse one NDJSON line from the continuous feed; null for heartbeats/garbage. */
export function parseChangeLine(line: string): ChangeRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null; // heartbeat
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj?.id !== 'string' || obj.seq == null) return null;
    return { seq: obj.seq, id: obj.id, deleted: Boolean(obj.deleted) };
  } catch {
    return null;
  }
}

/** What the follower does with one change record. */
export type ChangeRoute = 'resync' | 'enqueue' | 'skip';

/**
 * Decide the fate of a single change. Pure, so the routing rule is testable
 * without a feed, a database or a clock — this is the branch the whole growth
 * channel hangs off, and it used to send everything but `resync` to `skip`.
 */
export function routeChange(
  change: ChangeRecord,
  tracked: Set<string>,
  queued: Set<string>,
): ChangeRoute {
  if (change.deleted) return 'skip'; // unpublished: nothing to sync, nothing worth queueing
  if (tracked.has(change.id)) return 'resync';
  if (queued.has(change.id)) return 'skip'; // already waiting on the merit gate
  return 'enqueue';
}

export interface WatchOptions {
  signal?: AbortSignal;
  /** Start point when no cursor is stored. 'now' (default) = only future changes. */
  since?: string;
}

export async function watchNpmChanges(db: Database, opts: WatchOptions = {}): Promise<void> {
  const { signal } = opts;
  let backoff = 1000;

  while (!signal?.aborted) {
    let [tracked, queued] = await loadSeenSets(db);
    let seenAt = Date.now();
    const since = (await getWatchCursor(db, FEED_ID)) ?? opts.since ?? 'now';
    const url = `${FEED_URL}?feed=continuous&since=${encodeURIComponent(since)}&heartbeat=${HEARTBEAT_MS}`;
    logger.info(
      `watch: connecting from seq=${since} (${tracked.size} tracked, ${queued.size} queued)`,
    );

    try {
      const res = await fetch(url, { signal });
      if (!res.ok || !res.body) throw new Error(`feed responded ${res.status}`);
      backoff = 1000; // healthy connection, reset

      let sinceCheckpoint = 0;
      const buffered: string[] = [];

      /**
       * Flush buffered candidates, THEN advance the cursor — never the reverse.
       * A crash between the two replays a few changes, which `onConflictDoNothing`
       * absorbs; a crash the other way silently drops names the cursor already
       * claims we handled, and nothing would ever go back for them.
       */
      const checkpoint = async (seq: string): Promise<void> => {
        if (buffered.length > 0) {
          const batch = buffered.map((name) => ({ name, via: 'npm-changes' as const }));
          const inserted = await enqueueCandidates(db, batch).catch((err) => {
            // Keep following the feed; these names will come back around on
            // their next publish, and the other channels still run.
            logger.warn(`watch: enqueue of ${batch.length} candidate(s) failed: ${String(err)}`);
            return 0;
          });
          if (inserted > 0) logger.info(`watch: queued ${inserted} new discovery candidate(s)`);
          buffered.length = 0;
        }
        await setWatchCursor(db, FEED_ID, seq);
        sinceCheckpoint = 0;
      };

      for await (const line of ndjsonLines(res.body, signal)) {
        const change = parseChangeLine(line);
        if (!change) continue;
        const seq = String(change.seq);
        sinceCheckpoint++;

        if (Date.now() - seenAt > TRACKED_REFRESH_MS) {
          [tracked, queued] = await loadSeenSets(db);
          seenAt = Date.now();
        }

        const route = routeChange(change, tracked, queued);
        if (route === 'resync') {
          logger.info(`watch: re-syncing ${change.id} (seq=${seq})`);
          await syncOnePackage(db, change.id).catch((err) =>
            logger.warn(`watch: re-sync failed for ${change.id}: ${String(err)}`),
          );
          await checkpoint(seq);
          continue;
        }
        if (route === 'enqueue') {
          // Record it locally as we buffer, so the same package publishing twenty
          // times in an hour costs one insert attempt rather than twenty.
          queued.add(change.id);
          buffered.push(change.id);
        }

        if (sinceCheckpoint >= CHECKPOINT_EVERY || buffered.length >= ENQUEUE_BATCH) {
          await checkpoint(seq);
        }
      }
      logger.info('watch: feed stream ended; reconnecting');
    } catch (err) {
      if (signal?.aborted) break;
      logger.warn(`watch: ${String(err)}, retrying in ${backoff}ms`);
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
}

/** The two membership sets the loop decides against: what we already track (→
 *  re-sync on publish) and what is already queued (→ skip, the gate will get to
 *  it). Read together so a refresh can never leave them from different moments. */
async function loadSeenSets(db: Database): Promise<[Set<string>, Set<string>]> {
  const [tracked, queued] = await Promise.all([getAllPackageNames(db), getQueuedNames(db)]);
  return [new Set(tracked), queued];
}

/** Yield newline-delimited lines from a fetch ReadableStream as they arrive. */
async function* ndjsonLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        yield buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
