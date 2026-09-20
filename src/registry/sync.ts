/**
 * Keep lurq's copy of the official MCP registry current.
 *
 * Incremental by default: the largest `updatedAt` stored is kept in
 * `watch_state`, and the next run asks only for versions updated since then —
 * deleted ones included, which is how removals reach `mcp_remote_endpoints`.
 * The watermark is written once, after every page is stored, so a crash replays
 * rather than skips; storing a page twice is a no-op. It is also held back one
 * second, because the registry's `updated_since` boundary is not documented as
 * inclusive and a version updated in the same second as the watermark must not
 * be lost.
 */
import type { Database } from '../db/client';
import { storeRegistryEntries } from '../db/remoteEndpoints';
import { getWatchCursor, setWatchCursor } from '../db/watch';
import { listRegistry } from './official';

export const REGISTRY_CURSOR_ID = 'mcp-registry:updated_since';

export interface RegistrySyncOptions {
  /** Ignore the watermark and read every version. */
  full?: boolean;
  maxPages?: number;
  fetchImpl?: typeof fetch;
  base?: string;
  /** Watermark row to use; tests and one-off backfills keep their own. */
  cursorId?: string;
}

export interface RegistrySyncSummary {
  since: string | null;
  pages: number;
  versions: number;
  rejected: number;
  endpointsLinked: number;
  linksRemoved: number;
  endpointsRemoved: number;
  watermark: string | null;
}

export async function syncRegistry(
  db: Database,
  opts: RegistrySyncOptions = {},
): Promise<RegistrySyncSummary> {
  const cursorId = opts.cursorId ?? REGISTRY_CURSOR_ID;
  const since = opts.full ? null : await getWatchCursor(db, cursorId);
  const summary: RegistrySyncSummary = {
    since,
    pages: 0,
    versions: 0,
    rejected: 0,
    endpointsLinked: 0,
    linksRemoved: 0,
    endpointsRemoved: 0,
    watermark: since,
  };
  let newest = since ? new Date(since) : null;

  for await (const page of listRegistry({
    updatedSince: since ? new Date(since) : null,
    maxPages: opts.maxPages,
    fetchImpl: opts.fetchImpl,
    base: opts.base,
  })) {
    summary.pages++;
    summary.rejected += page.rejected;
    const s = await storeRegistryEntries(db, page.entries);
    summary.versions += s.versions;
    summary.endpointsLinked += s.endpointsLinked;
    summary.linksRemoved += s.linksRemoved;
    summary.endpointsRemoved += s.endpointsRemoved;
    for (const e of page.entries)
      if (e.updatedAt && (!newest || e.updatedAt > newest)) newest = e.updatedAt;
  }

  if (newest && newest.toISOString() !== since) {
    const held = new Date(newest.getTime() - 1_000).toISOString();
    await setWatchCursor(db, cursorId, held);
    summary.watermark = held;
  }
  return summary;
}
