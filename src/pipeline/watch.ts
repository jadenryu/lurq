/**
 * npm `_changes` follower — the streaming log.
 *
 * Subscribes to the registry replication feed and, whenever a *tracked* package
 * publishes a new version, re-syncs it so scores, advisories, and the version
 * timeline stay fresh without a full crawl. Resumable via a persisted sequence
 * cursor (db/watch), so a restart picks up where it left off instead of
 * replaying the registry. Long-running: an operator runs `lurq watch` as a
 * daemon, matching lurq's external-scheduler model.
 */
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { getAllPackageNames } from '../db/packages';
import { getWatchCursor, setWatchCursor } from '../db/watch';
import { syncOnePackage } from './single';

const FEED_ID = 'npm-changes';
const FEED_URL = 'https://replicate.npmjs.com/_changes';
const HEARTBEAT_MS = 30_000;
const TRACKED_REFRESH_MS = 5 * 60_000; // re-read the tracked set this often
const CHECKPOINT_EVERY = 200; // advance the cursor through churn at least this often
const MAX_BACKOFF_MS = 30_000;

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

export interface WatchOptions {
  signal?: AbortSignal;
  /** Start point when no cursor is stored. 'now' (default) = only future changes. */
  since?: string;
}

export async function watchNpmChanges(db: Database, opts: WatchOptions = {}): Promise<void> {
  const { signal } = opts;
  let backoff = 1000;

  while (!signal?.aborted) {
    let tracked = new Set(await getAllPackageNames(db));
    let trackedAt = Date.now();
    const since = (await getWatchCursor(db, FEED_ID)) ?? opts.since ?? 'now';
    const url = `${FEED_URL}?feed=continuous&since=${encodeURIComponent(since)}&heartbeat=${HEARTBEAT_MS}`;
    logger.info(`watch: connecting from seq=${since} (${tracked.size} tracked packages)`);

    try {
      const res = await fetch(url, { signal });
      if (!res.ok || !res.body) throw new Error(`feed responded ${res.status}`);
      backoff = 1000; // healthy connection — reset

      let sinceCheckpoint = 0;
      for await (const line of ndjsonLines(res.body, signal)) {
        const change = parseChangeLine(line);
        if (!change) continue;
        const seq = String(change.seq);
        sinceCheckpoint++;

        if (Date.now() - trackedAt > TRACKED_REFRESH_MS) {
          tracked = new Set(await getAllPackageNames(db));
          trackedAt = Date.now();
        }

        if (!change.deleted && tracked.has(change.id)) {
          logger.info(`watch: re-syncing ${change.id} (seq=${seq})`);
          await syncOnePackage(db, change.id).catch((err) =>
            logger.warn(`watch: re-sync failed for ${change.id}: ${String(err)}`),
          );
          await setWatchCursor(db, FEED_ID, seq);
          sinceCheckpoint = 0;
        } else if (sinceCheckpoint >= CHECKPOINT_EVERY) {
          await setWatchCursor(db, FEED_ID, seq); // advance through irrelevant churn
          sinceCheckpoint = 0;
        }
      }
      logger.info('watch: feed stream ended; reconnecting');
    } catch (err) {
      if (signal?.aborted) break;
      logger.warn(`watch: ${String(err)} — retrying in ${backoff}ms`);
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
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
