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
