/** Usage-axis serving layer (§4D): read-through the surface cache, extracting
 *  on a miss. Shared by the `usage` handler and the discovery worker (§4G). */
import type { ExportSymbol } from '../core/types';
import type { Database } from '../db/client';
import { getStoredSurface, upsertSurface } from '../db/apiSurfaces';
import { extractSurface, type ExtractOptions } from './extract';

/** Block-on-first-touch budget for the `usage` read path, mirroring
 *  FIRST_TOUCH_BUDGET_MS (§4A): past this the caller gets the README-fallback
 *  note while the extraction finishes in the background, so the *next* request
 *  for that version is a cache hit. */
export const USAGE_EXTRACT_BUDGET_MS = 4000;

/** CDN fetch tuning for the read path. The http default (15s × 4 attempts) is
 *  sized for the worker; on a request path a stuck jsDelivr must not outlive the
 *  budget by minutes, since the abandoned extraction keeps holding one of the
 *  6 per-host connection slots. */
const READ_PATH_FETCH: ExtractOptions = { timeoutMs: 3000, retries: 0 };

/** A flood of distinct versions must not grow memory without limit (same reason
 *  ingestQueue caps its backlog). Past the cap a miss degrades to the note. */
const MAX_INFLIGHT = 64;

/** Extractions in progress, keyed `name@version`, so concurrent misses for the
 *  same version share one CDN round-trip instead of N. */
const inFlight = new Map<string, Promise<ExportSymbol[] | null>>();

export interface SurfaceLookupOptions {
  /** Wall-clock budget for a cold-miss extraction. Omitted → wait for it (the
   *  worker and the landing-content generator want the surface, not a fast no).
   *  0 → skip extraction entirely (cache-only). */
  budgetMs?: number;
  /** Override the CDN fetch timeout/retries. */
  fetch?: ExtractOptions;
}

/** Resolve with the task's value, or null once `budgetMs` elapses. The task is
 *  deliberately NOT cancelled: its cache write is the point. */
function raceBudget<T>(task: Promise<T>, budgetMs: number): Promise<T | null> {
  return Promise.race([task, new Promise<null>((resolve) => setTimeout(resolve, budgetMs, null))]);
}

/** Start (or join) the single extraction for `name@version`. */
function extractOnce(
  db: Database,
  name: string,
  version: string,
  fetchOpts: ExtractOptions,
): Promise<ExportSymbol[] | null> {
  const key = `${name}@${version}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (inFlight.size >= MAX_INFLIGHT) return Promise.resolve(null);

  const task = extractSurface(name, version, fetchOpts)
    .then(async (extracted) => {
      // Best-effort write: a database at its size limit must not turn a
      // successful extraction into a failed read.
      if (extracted) await upsertSurface(db, name, version, extracted).catch(() => {});
      return extracted;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}

/**
 * The API surface for `name@version` from cache, or extract-and-store on a miss.
 * Returns null when types can't be resolved (caller falls back to README).
 * Cache-forever: versions are immutable.
 */
export async function getOrExtractSurface(
  db: Database,
  name: string,
  version: string,
  opts: SurfaceLookupOptions = {},
): Promise<ExportSymbol[] | null> {
  const stored = await getStoredSurface(db, name, version);
  if (stored) return stored;
  if (opts.budgetMs === 0) return null;

  // A budget means a caller is waiting on a request path, which is also what
  // justifies the tighter fetch ceiling; the unbudgeted worker keeps the http
  // defaults so a slow-but-working CDN still yields a surface.
  const fetchOpts = opts.fetch ?? (opts.budgetMs === undefined ? {} : READ_PATH_FETCH);
  const task = extractOnce(db, name, version, fetchOpts);
  return opts.budgetMs === undefined ? task : raceBudget(task, opts.budgetMs);
}

/** Test-only: drop memoized in-flight extractions. */
export function resetSurfaceInflight(): void {
  inFlight.clear();
}
