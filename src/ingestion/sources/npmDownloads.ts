/**
 * npm downloads client (§9.2). Weekly downloads + 90-day growth.
 * Growth = (last-30d avg) vs (prior-30d avg), as a signed fraction.
 *
 * Note: the downloads API historically does not serve per-package data for
 * scoped packages; those calls 404 and we degrade to null (handled upstream).
 */
import { CACHE_TTL } from '../../core/constants';
import { httpGetJson } from '../../core/http';
import type { NpmDownloadsData } from '../types';

const HOST = 'api.npmjs.org';

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

  // Use the last 60 days: prior 30 vs most-recent 30.
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

/** Build a `start:end` range string covering the last `days` days. */
export function last90DayRange(now: Date = new Date()): string {
  const end = now;
  const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  return `${ymd(start)}:${ymd(end)}`;
}

export async function fetchNpmDownloads(
  name: string,
  fetchImpl?: typeof fetch,
): Promise<NpmDownloadsData> {
  const weekUrl = `https://${HOST}/downloads/point/last-week/${name}`;
  // npm's range API needs an explicit date range, not a named "last-90-days".
  const rangeUrl = `https://${HOST}/downloads/range/${last90DayRange()}/${name}`;

  const [weekRes, rangeRes] = await Promise.allSettled([
    httpGetJson<any>(weekUrl, { host: HOST, ttlMs: CACHE_TTL.npmDownloads, fetchImpl }),
    httpGetJson<any>(rangeUrl, { host: HOST, ttlMs: CACHE_TTL.npmDownloads, fetchImpl }),
  ]);

  return {
    weeklyDownloads:
      weekRes.status === 'fulfilled' ? parseWeeklyDownloads(weekRes.value.data) : null,
    downloadGrowth90d:
      rangeRes.status === 'fulfilled' ? parseDownloadGrowth(rangeRes.value.data) : null,
  };
}
