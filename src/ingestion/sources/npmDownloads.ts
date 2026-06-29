/**
 * npm downloads client (§9.2). Weekly downloads + 90-day growth.
 *
 * Weekly downloads is fetched in BULK at the pipeline level — npm's point API
 * accepts up to 128 comma-separated packages per call, which avoids the harsh
 * rate-limiting that per-package bursts trigger. The range (growth) API has no
 * bulk form, so growth is a per-package best-effort secondary signal.
 *
 * Bulk does not support scoped (@scope/name) packages; those are fetched singly.
 */
import { CACHE_TTL } from '../../core/constants';
import { httpGetJson, HttpError } from '../../core/http';

const HOST = 'api.npmjs.org';
const BULK_CHUNK = 128;

export function parseWeeklyDownloads(json: any): number | null {
  const value = json?.downloads;
  return typeof value === 'number' ? value : null;
}

interface RangePoint {
  day: string;
  downloads: number;
}

/** Compute the 90d growth fraction from a daily-downloads range. */
export function parseDownloadGrowth(json: any): number | null {
  const points: RangePoint[] = Array.isArray(json?.downloads) ? json.downloads : [];
  if (points.length < 60) return null;
  const tail = points.slice(-60);
  const prior = tail.slice(0, 30);
  const recent = tail.slice(30);
  const sum = (arr: RangePoint[]) => arr.reduce((acc, p) => acc + (p.downloads || 0), 0);
  const priorAvg = sum(prior) / prior.length;
  const recentAvg = sum(recent) / recent.length;
  if (priorAvg <= 0) return recentAvg > 0 ? 1 : 0;
  return (recentAvg - priorAvg) / priorAvg;
}

/** Format a Date as YYYY-MM-DD (UTC) for the npm range API. */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Build a `start:end` range string covering the last 90 days. */
export function last90DayRange(now: Date = new Date()): string {
  const end = now;
  const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  return `${ymd(start)}:${ymd(end)}`;
}

/** Parse a bulk point response into a name→downloads map (handles single + multi forms). */
export function parseBulkWeekly(json: any, requested: string[]): Map<string, number | null> {
  const map = new Map<string, number | null>();
  // A single-package request returns the object directly, not keyed by name.
  if (json && typeof json.downloads === 'number' && typeof json.package === 'string') {
    map.set(json.package, json.downloads);
    return map;
  }
  for (const name of requested) {
    const entry = json?.[name];
    map.set(name, entry && typeof entry.downloads === 'number' ? entry.downloads : null);
  }
  return map;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Single-package weekly downloads. 404 → null (no per-package data). */
export async function fetchWeeklyDownloads(
  name: string,
  fetchImpl?: typeof fetch,
): Promise<number | null> {
  try {
    const { data } = await httpGetJson<any>(
      `https://${HOST}/downloads/point/last-week/${name}`,
      { host: HOST, ttlMs: CACHE_TTL.npmDownloads, retries: 5, fetchImpl },
    );
    return parseWeeklyDownloads(data);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/** Per-package 90d growth (best-effort secondary signal). */
export async function fetchDownloadGrowth(
  name: string,
  fetchImpl?: typeof fetch,
): Promise<number | null> {
  try {
    const { data } = await httpGetJson<any>(
      `https://${HOST}/downloads/range/${last90DayRange()}/${name}`,
      { host: HOST, ttlMs: CACHE_TTL.npmDownloads, retries: 3, fetchImpl },
    );
    return parseDownloadGrowth(data);
  } catch {
    return null;
  }
}

/**
 * Bulk-fetch weekly downloads for many packages. Unscoped packages go through
 * the 128-at-a-time bulk endpoint; scoped packages are fetched individually.
 */
export async function fetchBulkWeeklyDownloads(
  names: string[],
  fetchImpl?: typeof fetch,
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  const unscoped = names.filter((n) => !n.startsWith('@'));
  const scoped = names.filter((n) => n.startsWith('@'));

  for (const batch of chunk(unscoped, BULK_CHUNK)) {
    try {
      const { data } = await httpGetJson<any>(
        `https://${HOST}/downloads/point/last-week/${batch.join(',')}`,
        { host: HOST, ttlMs: CACHE_TTL.npmDownloads, retries: 5, fetchImpl },
      );
      for (const [k, v] of parseBulkWeekly(data, batch)) result.set(k, v);
    } catch {
      // Leave this batch absent; per-package fallback will retry it.
    }
  }

  for (const name of scoped) {
    try {
      result.set(name, await fetchWeeklyDownloads(name, fetchImpl));
    } catch {
      /* leave absent → per-package fallback */
    }
  }

  return result;
}
