/**
 * npm registry search client (§2B). Seeds the discovery crawler's long-tail
 * channels: keyword/category search and a recently-published sweep. This is the
 * niche workhorse — the dependency graph structurally can't find niche
 * *alternatives* (a new package shares no edge with the incumbent it competes
 * with), so that job lives here.
 */
import { CACHE_TTL } from '../../core/constants';
import { httpGetJson } from '../../core/http';

const HOST = 'registry.npmjs.org';

export interface NpmSearchHit {
  name: string;
  /** ISO publish date of the matched version, if reported. */
  date: string | null;
}

/**
 * Run an npm registry search. `query` uses npm's search qualifier syntax, e.g.
 * `keywords:orm` or `orm typescript`. Returns name + publish date per hit.
 * Best-effort: returns [] on any failure.
 */
export async function searchNpm(
  query: string,
  size = 20,
  fetchImpl?: typeof fetch,
): Promise<NpmSearchHit[]> {
  const url = `https://${HOST}/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`;
  try {
    const { data } = await httpGetJson<any>(url, {
      host: HOST,
      ttlMs: CACHE_TTL.npmRegistry,
      fetchImpl,
    });
    const objects: any[] = Array.isArray(data?.objects) ? data.objects : [];
    return objects
      .map((o) => ({ name: o?.package?.name, date: o?.package?.date ?? null }))
      .filter((h): h is NpmSearchHit => typeof h.name === 'string');
  } catch {
    return [];
  }
}
