/**
 * deps.dev client (§9.4). Primary source for OpenSSF Scorecard and security
 * advisories.
 *  - Scorecard comes from the project endpoint (keyed by github.com/owner/repo).
 *  - Advisories: the version endpoint lists advisoryKeys; we fetch each (capped)
 *    and derive a severity bucket from its CVSS score.
 */
import { CACHE_TTL } from '../../core/constants';
import { httpGetJson, type HttpResponse } from '../../core/http';
import type { Advisory, AdvisorySeverity } from '../../core/types';
import type { DepsDevData } from '../types';

const HOST = 'api.deps.dev';
const MAX_ADVISORIES = 10;

function encodeName(name: string): string {
  return encodeURIComponent(name);
}

export function severityFromCvss(score: number | null | undefined): AdvisorySeverity {
  if (score == null) return 'moderate';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'moderate';
  if (score > 0) return 'low';
  return 'info';
}

export function parseScorecard(json: any): number | null {
  const score = json?.scorecard?.overallScore;
  return typeof score === 'number' ? score : null;
}

export function parseAdvisoryKeys(versionJson: any): string[] {
  const keys = versionJson?.advisoryKeys;
  if (!Array.isArray(keys)) return [];
  return keys
    .map((k: any) => (typeof k === 'string' ? k : k?.id))
    .filter((id: unknown): id is string => typeof id === 'string');
}

export function parseAdvisoryDetail(json: any): Advisory {
  return {
    id: json?.advisoryKey?.id ?? json?.advisoryKey ?? 'unknown',
    severity: severityFromCvss(json?.cvss3Score),
    summary: json?.title ?? '',
  };
}

export async function fetchScorecard(
  owner: string,
  repo: string,
  fetchImpl?: typeof fetch,
): Promise<number | null> {
  const projectKey = encodeURIComponent(`github.com/${owner}/${repo}`);
  const url = `https://${HOST}/v3/projects/${projectKey}`;
  try {
    const { data } = await httpGetJson<any>(url, {
      host: HOST,
      ttlMs: CACHE_TTL.depsDev,
      fetchImpl,
    });
    return parseScorecard(data);
  } catch {
    return null;
  }
}

export async function fetchAdvisories(
  name: string,
  version: string,
  fetchImpl?: typeof fetch,
): Promise<Advisory[]> {
  const versionUrl = `https://${HOST}/v3/systems/npm/packages/${encodeName(name)}/versions/${encodeURIComponent(version)}`;
  let keys: string[] = [];
  try {
    const { data } = await httpGetJson<any>(versionUrl, {
      host: HOST,
      ttlMs: CACHE_TTL.depsDev,
      fetchImpl,
    });
    keys = parseAdvisoryKeys(data).slice(0, MAX_ADVISORIES);
  } catch {
    return [];
  }

  const details = await Promise.allSettled(
    keys.map((key) =>
      httpGetJson<any>(`https://${HOST}/v3/advisories/${encodeURIComponent(key)}`, {
        host: HOST,
        ttlMs: CACHE_TTL.depsDev,
        fetchImpl,
      }),
    ),
  );
  return details
    .filter(
      (d): d is PromiseFulfilledResult<HttpResponse<any>> => d.status === 'fulfilled',
    )
    .map((d) => parseAdvisoryDetail(d.value.data));
}

/**
 * Direct dependency names from the deps.dev graph (§2B). These are the packages
 * a seed is *built on* — the adjacent foundations. Best-effort: returns [] on any
 * failure. We deliberately do NOT rank by dependent count (that re-introduces the
 * popularity bias §2B exists to avoid); the caller gates on quality instead.
 */
export async function fetchDependencyNames(
  name: string,
  version: string,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  const url = `https://${HOST}/v3/systems/npm/packages/${encodeName(name)}/versions/${encodeURIComponent(version)}:dependencies`;
  try {
    const { data } = await httpGetJson<any>(url, {
      host: HOST,
      ttlMs: CACHE_TTL.depsDev,
      fetchImpl,
    });
    const nodes: any[] = Array.isArray(data?.nodes) ? data.nodes : [];
    const names = nodes
      .map((n) => n?.versionKey?.name)
      .filter((n: unknown): n is string => typeof n === 'string' && n !== name);
    return [...new Set(names)];
  } catch {
    return [];
  }
}

export interface ResolvedNode {
  name: string;
  version: string;
}

/**
 * The full resolved dependency closure for `name@version` (§4B) — every node npm
 * would put in node_modules, each with its exact resolved version. This is a
 * co-installation witness: the resolver found a working assignment including all
 * of them and the artifact shipped, so every pair inside provably co-resolves.
 * Best-effort: [] on any failure. Unlike `fetchDependencyNames`, keeps versions.
 */
export async function fetchResolvedGraph(
  name: string,
  version: string,
  fetchImpl?: typeof fetch,
): Promise<ResolvedNode[]> {
  const url = `https://${HOST}/v3/systems/npm/packages/${encodeName(name)}/versions/${encodeURIComponent(version)}:dependencies`;
  try {
    const { data } = await httpGetJson<any>(url, {
      host: HOST,
      ttlMs: CACHE_TTL.depsDev,
      fetchImpl,
    });
    const nodes: any[] = Array.isArray(data?.nodes) ? data.nodes : [];
    const out: ResolvedNode[] = [];
    const seen = new Set<string>();
    for (const n of nodes) {
      const nm = n?.versionKey?.name;
      const ver = n?.versionKey?.version;
      if (typeof nm !== 'string' || typeof ver !== 'string') continue;
      const key = `${nm}@${ver}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: nm, version: ver });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Direct dependencies only (§4G BFS), with versions — the ~15 packages the author
 * deliberately chose, not the transitive plumbing. Reads the graph `edges`: a
 * node is direct iff an edge from the root (the `SELF` node) points to it. Falls
 * back to [] on failure. Enqueuing only these keeps discovery from re-introducing
 * the plumbing explosion one hop later.
 */
export async function fetchDirectDependencies(
  name: string,
  version: string,
  fetchImpl?: typeof fetch,
): Promise<ResolvedNode[]> {
  const url = `https://${HOST}/v3/systems/npm/packages/${encodeName(name)}/versions/${encodeURIComponent(version)}:dependencies`;
  try {
    const { data } = await httpGetJson<any>(url, {
      host: HOST,
      ttlMs: CACHE_TTL.depsDev,
      fetchImpl,
    });
    const nodes: any[] = Array.isArray(data?.nodes) ? data.nodes : [];
    const edges: any[] = Array.isArray(data?.edges) ? data.edges : [];
    // Root is the SELF node; deps.dev conventionally places it at index 0.
    const rootIdx = nodes.findIndex((n) => n?.relation === 'SELF');
    const root = rootIdx >= 0 ? rootIdx : 0;
    const out: ResolvedNode[] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      if (e?.fromNode !== root) continue;
      const target = nodes[e?.toNode];
      const nm = target?.versionKey?.name;
      const ver = target?.versionKey?.version;
      if (typeof nm !== 'string' || typeof ver !== 'string' || nm === name) continue;
      if (seen.has(nm)) continue;
      seen.add(nm);
      out.push({ name: nm, version: ver });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchDepsDev(
  name: string,
  version: string | null,
  repo: { owner: string; repo: string } | null,
  fetchImpl?: typeof fetch,
): Promise<DepsDevData> {
  const [scorecard, advisories] = await Promise.all([
    repo ? fetchScorecard(repo.owner, repo.repo, fetchImpl) : Promise.resolve(null),
    version ? fetchAdvisories(name, version, fetchImpl) : Promise.resolve([]),
  ]);
  return { scorecard, advisories };
}
