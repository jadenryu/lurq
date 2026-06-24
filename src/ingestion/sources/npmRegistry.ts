/**
 * npm registry client (§9.1). Base metadata: version, description, license,
 * repository, publish times, deprecation, maintainers, README.
 */
import { CACHE_TTL } from '../../core/constants';
import { httpGetJson } from '../../core/http';
import type { NpmRegistryData } from '../types';

const HOST = 'registry.npmjs.org';

/** Encode a package name for a registry URL (scoped names need `/` → `%2F`). */
export function encodeNpmName(name: string): string {
  return name.startsWith('@') ? name.replace('/', '%2F') : name;
}

/** Extract `{ owner, repo }` from any GitHub repository URL form. */
export function parseGithubRepo(
  url: string | null | undefined,
): { owner: string; repo: string } | null {
  if (!url) return null;
  const match = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}

function normalizeRepoUrl(
  repository: unknown,
  homepage: string | null,
): { repoUrl: string | null; repo: { owner: string; repo: string } | null } {
  let raw: string | null = null;
  if (typeof repository === 'string') raw = repository;
  else if (repository && typeof repository === 'object' && 'url' in repository) {
    raw = String((repository as { url: unknown }).url);
  }
  const repo = parseGithubRepo(raw) ?? parseGithubRepo(homepage);
  const repoUrl = repo ? `https://github.com/${repo.owner}/${repo.repo}` : (cleanUrl(raw) ?? null);
  return { repoUrl, repo };
}

function cleanUrl(url: string | null): string | null {
  if (!url) return null;
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

function pickLicense(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'type' in value) return String((value as { type: unknown }).type);
  return null;
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export function parseNpmRegistry(json: any): NpmRegistryData {
  const latest: string | null = json?.['dist-tags']?.latest ?? null;
  const latestManifest = latest ? (json?.versions?.[latest] ?? {}) : {};
  const time = json?.time ?? {};

  const repository = json?.repository ?? latestManifest?.repository;
  const homepage = json?.homepage ?? latestManifest?.homepage ?? null;
  const { repoUrl, repo } = normalizeRepoUrl(repository, homepage);

  const deprecated = Boolean(latestManifest?.deprecated ?? json?.deprecated);
  const maintainers = Array.isArray(json?.maintainers) ? json.maintainers.length : null;
  const name: string = json?.name ?? '';

  return {
    name,
    description: json?.description ?? latestManifest?.description ?? null,
    latestVersion: latest,
    license: pickLicense(json?.license ?? latestManifest?.license),
    homepage,
    repo,
    repoUrl,
    firstPublishedAt: toDate(time?.created),
    lastReleaseAt: toDate(latest ? time?.[latest] : null) ?? toDate(time?.modified),
    deprecated,
    maintainersCount: maintainers,
    readme: typeof json?.readme === 'string' ? json.readme : null,
    keywords: parseKeywords(json?.keywords ?? latestManifest?.keywords),
    hasTypes: detectTypes(name, latestManifest),
    hasTestScript: detectTestScript(latestManifest),
    directDependenciesCount: countDeps(latestManifest?.dependencies),
    hasProvenance: detectProvenance(latestManifest),
  };
}

function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((k): k is string => typeof k === 'string');
}

/** Ships types if the manifest declares `types`/`typings`, or it IS an @types pkg. */
function detectTypes(name: string, manifest: any): boolean {
  if (typeof manifest?.types === 'string' || typeof manifest?.typings === 'string') return true;
  if (name.startsWith('@types/')) return true;
  // `exports` map with a `types` condition (modern dual-package layout).
  const exportsField = manifest?.exports;
  if (exportsField && typeof exportsField === 'object') {
    const serialized = JSON.stringify(exportsField);
    if (serialized.includes('"types"')) return true;
  }
  return false;
}

/** A real test script — npm's `init` leaves a placeholder we must not count. */
function detectTestScript(manifest: any): boolean {
  const test = manifest?.scripts?.test;
  if (typeof test !== 'string' || test.trim() === '') return false;
  return !/no test specified/i.test(test);
}

function countDeps(deps: unknown): number | null {
  if (!deps || typeof deps !== 'object') return 0;
  return Object.keys(deps as Record<string, unknown>).length;
}

/** npm provenance leaves a signed attestation on the published dist. */
function detectProvenance(manifest: any): boolean {
  return Boolean(manifest?.dist?.attestations);
}

export async function fetchNpmRegistry(
  name: string,
  fetchImpl?: typeof fetch,
): Promise<NpmRegistryData> {
  const url = `https://${HOST}/${encodeNpmName(name)}`;
  const { data } = await httpGetJson<any>(url, {
    host: HOST,
    ttlMs: CACHE_TTL.npmRegistry,
    fetchImpl,
  });
  return parseNpmRegistry(data);
}

/** Live existence check for `verify` (§12.3.4) — bypasses cache. */
export async function npmPackageExists(name: string, fetchImpl?: typeof fetch): Promise<boolean> {
  const url = `https://${HOST}/${encodeNpmName(name)}`;
  try {
    const { status } = await httpGetJson<any>(url, {
      host: HOST,
      ttlMs: 0,
      retries: 1,
      fetchImpl,
    });
    return status === 200;
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && (err as any).status === 404) {
      return false;
    }
    throw err;
  }
}
