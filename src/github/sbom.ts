/**
 * Resolved dependency tree, via GitHub's dependency-graph SBOM.
 *
 * Everything else in this product reads declared ranges from `package.json`,
 * which makes the whole transitive tree invisible — and transitives are where
 * most advisories actually live. A repo can read "0 advisories" while shipping a
 * known-vulnerable package four levels down.
 *
 * We do NOT parse lockfiles to fix that. There are five formats across npm v1–v3,
 * yarn classic and berry, pnpm, and bun (binary), they run to megabytes, and
 * GitHub already resolves all of them into one SPDX document. One authenticated
 * call replaces a parser suite we would then own forever.
 *
 * The cost is a dependency on a repo feature: the dependency graph is on by
 * default for public repos but opt-in for private ones. A repo without it gets
 * `null`, reported as "not available" — never as "no transitive risk".
 */
import { HttpError } from '../core/http';
import { installationGet } from './app';
import { GithubAppError } from './app';

/** One node of the resolved tree. */
export interface ResolvedDep {
  name: string;
  version: string;
}

interface SpdxPackage {
  name?: string;
  versionInfo?: string;
  externalRefs?: { referenceType?: string; referenceLocator?: string }[];
}

interface SbomResponse {
  sbom?: { packages?: SpdxPackage[] };
}

/**
 * A real tree runs to a few thousand nodes; past this the repo is a monorepo of
 * monorepos and the summary is what matters, not the list. Reported, not silent.
 */
export const SBOM_NODE_CAP = 5000;

/**
 * Parse an npm package identity out of a Package URL.
 *
 * Scoped names are the whole difficulty: producers emit `pkg:npm/%40babel/core`
 * (correctly percent-encoded) and `pkg:npm/@babel/core` (not) interchangeably,
 * and the version separator is the LAST `@`, which a naive split gets wrong for
 * every scoped package.
 */
export function parseNpmPurl(purl: string): ResolvedDep | null {
  if (!purl.startsWith('pkg:npm/')) return null;
  let body = purl.slice('pkg:npm/'.length);

  // Drop qualifiers and subpath: `pkg:npm/foo@1.0.0?arch=x64#sub`.
  const cut = body.search(/[?#]/);
  if (cut !== -1) body = body.slice(0, cut);

  const at = body.lastIndexOf('@');
  // `@` at index 0 is a scope marker, not a version separator.
  if (at <= 0) return null;

  const name = decodeURIComponent(body.slice(0, at));
  const version = decodeURIComponent(body.slice(at + 1));
  if (!name || !version) return null;
  return { name, version };
}

/** Extract every npm node from an SPDX document, deduped by name@version. */
export function parseSbom(json: unknown): ResolvedDep[] {
  const packages = (json as SbomResponse)?.sbom?.packages;
  if (!Array.isArray(packages)) return [];

  const seen = new Set<string>();
  const out: ResolvedDep[] = [];

  for (const pkg of packages) {
    const purl = pkg.externalRefs?.find((ref) => ref.referenceType === 'purl')?.referenceLocator;
    // The purl is authoritative. `name` is a display string whose format varies
    // by producer ("npm:lodash", "lodash"), so it is only a fallback — and then
    // only when `versionInfo` supplies the version the purl would have carried.
    const parsed = purl
      ? parseNpmPurl(purl)
      : pkg.name?.startsWith('npm:') && pkg.versionInfo
        ? { name: pkg.name.slice(4), version: pkg.versionInfo }
        : null;
    if (!parsed) continue;

    const key = `${parsed.name}@${parsed.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
    if (out.length >= SBOM_NODE_CAP) break;
  }

  return out;
}

export interface SbomResult {
  deps: ResolvedDep[];
  /** True when the tree hit SBOM_NODE_CAP and is therefore incomplete. */
  truncated: boolean;
}

/**
 * Fetch the resolved tree, or null when the repo has no dependency graph.
 *
 * A 403 here means the feature is disabled for that repository, which is a
 * normal state and not an error — callers surface it as "not available" so the
 * dashboard never implies a clean tree it did not actually see.
 */
export async function fetchResolvedTree(
  installationId: number,
  fullName: string,
): Promise<SbomResult | null> {
  try {
    const data = await installationGet<SbomResponse>(
      installationId,
      `/repos/${fullName}/dependency-graph/sbom`,
    );
    const deps = parseSbom(data);
    return { deps, truncated: deps.length >= SBOM_NODE_CAP };
  } catch (err) {
    const status =
      err instanceof HttpError ? err.status : err instanceof GithubAppError ? err.status : 0;
    // 403: dependency graph disabled. 404: repo gone, or the endpoint is not
    // enabled for this installation. Neither is worth failing a scan over — the
    // direct-dependency drift above it is still correct and useful.
    if (status === 403 || status === 404) return null;
    throw err;
  }
}
