/**
 * Bundlephobia client (§9.5). Minified + gzipped size for frontend packages.
 * Strictly best-effort: this API is slow and flaky, so failures degrade to null
 * and never block ingestion (per R1 build decision). Cached aggressively (7d).
 */
import { CACHE_TTL } from '../../core/constants';
import { httpGetJson } from '../../core/http';
import { isFrontendCategory, type Category } from '../../core/types';
import type { BundlephobiaData } from '../types';

const HOST = 'bundlephobia.com';

export function parseBundleSize(json: any): number | null {
  const gzipBytes = json?.gzip;
  if (typeof gzipBytes !== 'number') return null;
  return Math.round((gzipBytes / 1024) * 10) / 10; // KB, 1 decimal
}

/**
 * Fetch bundle size — only for frontend categories (§9.5); returns null for
 * backend-only packages without making a request.
 */
export async function fetchBundlephobia(
  name: string,
  category: Category | null,
  fetchImpl?: typeof fetch,
): Promise<BundlephobiaData> {
  if (!isFrontendCategory(category)) return { bundleMinGzipKb: null };

  const url = `https://${HOST}/api/size?package=${encodeURIComponent(name)}`;
  try {
    const { data } = await httpGetJson<any>(url, {
      host: HOST,
      ttlMs: CACHE_TTL.bundlephobia,
      timeoutMs: 12_000,
      retries: 1,
      fetchImpl,
    });
    return { bundleMinGzipKb: parseBundleSize(data) };
  } catch {
    return { bundleMinGzipKb: null };
  }
}
