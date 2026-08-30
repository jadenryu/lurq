/**
 * npm `_changes` follower — the registry's publish log.
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
 * **Polled, not streamed.** This followed `?feed=continuous&since=now` as an
 * NDJSON stream, which the registry now answers with a flat 400 — as it does for
 * `feed=normal` and any non-numeric `since`. Whatever this was tested against is
 * gone; what is served today is a batched page, `?since=<seq>&limit=<n>` →
 * `{results, last_seq}`, so the follower pages forward and idles when it catches
 * up. Resumable either way: the cursor is a sequence number in `watch_state`, and
 * with none stored it starts from the head rather than replaying all of npm.
 */
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { enqueueCandidates, getQueuedNames } from '../db/discovery';
import { getAllPackageNames } from '../db/packages';
import { getWatchCursor, setWatchCursor } from '../db/watch';
import { syncOnePackage } from './single';

const FEED_ID = 'npm-changes';
const FEED_URL = 'https://replicate.npmjs.com/_changes';
/** Changes per request. The registry serves 10k happily; 1k keeps a single
 *  failed page cheap to retry and the memory flat while catching up. */
const PAGE_SIZE = 1000;
/** Wait this long after a page that did not fill — we are at the head. */
const IDLE_POLL_MS = 30_000;
const TRACKED_REFRESH_MS = 5 * 60_000; // re-read the membership sets this often
const MAX_BACKOFF_MS = 30_000;
/** Buffered new names flushed per insert, so a busy page is one round-trip. */
const ENQUEUE_BATCH = 200;

export interface ChangeRecord {
  seq: number | string;
  id: string;
  deleted: boolean;
}

/** Coerce one entry of the `results` array; null for anything malformed. */
export function parseChange(obj: unknown): ChangeRecord | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const rec = obj as { seq?: unknown; id?: unknown; deleted?: unknown };
  if (typeof rec.id !== 'string' || rec.seq == null) return null;
  if (typeof rec.seq !== 'number' && typeof rec.seq !== 'string') return null;
  return { seq: rec.seq, id: rec.id, deleted: Boolean(rec.deleted) };
}

export interface ChangesPage {
  changes: ChangeRecord[];
  lastSeq: string | null;
}

/** Coerce a `_changes` response body. A page we cannot read is an empty page,
 *  never a crash — the caller backs off and retries the same cursor. */
export function parseChangesPage(body: unknown): ChangesPage {
  if (typeof body !== 'object' || body === null) return { changes: [], lastSeq: null };
  const { results, last_seq: lastSeq } = body as { results?: unknown; last_seq?: unknown };
  const changes = Array.isArray(results)
    ? results.map(parseChange).filter((c): c is ChangeRecord => c !== null)
    : [];
  return {
    changes,
    lastSeq: typeof lastSeq === 'number' || typeof lastSeq === 'string' ? String(lastSeq) : null,
  };
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
  /** Sequence to start from when no cursor is stored. Default: the current head,
   *  i.e. only changes published from now on. */
  since?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

async function getJson(url: string, fetchImpl: typeof fetch, signal?: AbortSignal) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`feed responded ${res.status}`);
  return res.json();
}

/** The newest sequence the registry knows about, for a first-ever start. */
export async function fetchHeadSeq(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  const body = await getJson(`${FEED_URL}?descending=true&limit=1`, fetchImpl, signal);
  return parseChangesPage(body).lastSeq;
}

/** The two membership sets the loop decides against: what we already track (→
 *  re-sync on publish) and what is already queued (→ skip, the gate will get to
 *  it). Read together so a refresh can never leave them from different moments. */
async function loadSeenSets(db: Database): Promise<[Set<string>, Set<string>]> {
  const [tracked, queued] = await Promise.all([getAllPackageNames(db), getQueuedNames(db)]);
  return [new Set(tracked), queued];
}

export async function watchNpmChanges(db: Database, opts: WatchOptions = {}): Promise<void> {
  const { signal, fetchImpl = fetch } = opts;
  let backoff = 1000;

  let [tracked, queued] = await loadSeenSets(db);
  let seenAt = Date.now();

  let cursor =
    (await getWatchCursor(db, FEED_ID)) ??
    opts.since ??
    (await fetchHeadSeq(fetchImpl, signal).catch(() => null));
  if (cursor == null) {
    logger.warn('watch: could not establish a starting sequence; giving up.');
    return;
  }
  logger.info(
    `watch: following from seq=${cursor} (${tracked.size} tracked, ${queued.size} queued)`,
  );

  while (!signal?.aborted) {
    try {
      const url = `${FEED_URL}?since=${encodeURIComponent(cursor)}&limit=${PAGE_SIZE}`;
      const { changes, lastSeq } = parseChangesPage(await getJson(url, fetchImpl, signal));
      backoff = 1000; // healthy response, reset

      if (Date.now() - seenAt > TRACKED_REFRESH_MS) {
        [tracked, queued] = await loadSeenSets(db);
        seenAt = Date.now();
      }

      const buffered: string[] = [];
      const flush = async (): Promise<void> => {
        if (buffered.length === 0) return;
        const batch = buffered.map((name) => ({ name, via: 'npm-changes' as const }));
        const inserted = await enqueueCandidates(db, batch).catch((err) => {
          // Keep following the feed; these names come back on their next publish,
          // and the other discovery channels still run.
          logger.warn(`watch: enqueue of ${batch.length} candidate(s) failed: ${String(err)}`);
          return 0;
        });
        if (inserted > 0) logger.info(`watch: queued ${inserted} new discovery candidate(s)`);
        buffered.length = 0;
      };

      let resynced = 0;
      for (const change of changes) {
        if (signal?.aborted) break;
        const route = routeChange(change, tracked, queued);
        if (route === 'resync') {
          await syncOnePackage(db, change.id).catch((err) =>
            logger.warn(`watch: re-sync failed for ${change.id}: ${String(err)}`),
          );
          resynced++;
        } else if (route === 'enqueue') {
          // Record it locally as we buffer, so the same package publishing twenty
          // times in an hour costs one insert attempt rather than twenty.
          queued.add(change.id);
          buffered.push(change.id);
          if (buffered.length >= ENQUEUE_BATCH) await flush();
        }
      }

      // Flush BEFORE advancing the cursor, never after. A crash between the two
      // replays a page, which `onConflictDoNothing` absorbs; a crash the other
      // way drops names the cursor already claims we handled, and nothing would
      // ever go back for them.
      await flush();
      if (lastSeq !== null && lastSeq !== cursor) {
        cursor = lastSeq;
        await setWatchCursor(db, FEED_ID, cursor);
      }
      if (changes.length > 0) {
        logger.info(`watch: ${changes.length} change(s), ${resynced} re-synced, seq=${cursor}`);
      }

      // A page that did not fill means we are at the head — stop hammering.
      if (changes.length < PAGE_SIZE) await sleep(IDLE_POLL_MS, signal);
    } catch (err) {
      if (signal?.aborted) break;
      logger.warn(`watch: ${String(err)}, retrying in ${backoff}ms`);
      await sleep(backoff, signal);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
  logger.info('watch: stopped.');
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
