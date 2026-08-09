/**
 * OSV (osv.dev) — advisories matched to an EXACT installed version.
 *
 * Everywhere else lurq stores advisories against a package, computed for its
 * latest version. That is the right shape for scoring a package, and the wrong
 * shape for a resolved dependency tree: a repo running lodash@4.17.21 was being
 * told "lodash has known advisories" on the strength of an advisory that only
 * affects 4.17.20 and below. The honest phrasing for that data was "packages
 * with known advisories", never "vulnerable installs" — a number nobody can act
 * on, because acting on it means upgrading something already fixed.
 *
 * OSV answers the precise question directly. Rather than storing affected
 * ranges and re-implementing semver range matching per ecosystem, `querybatch`
 * takes (package, version) pairs and returns the vulnerabilities that actually
 * apply. OSV owns the matching, including the ecosystem-specific edge cases
 * (prereleases, `0.0.0-` sentinels, withdrawn advisories) that a hand-rolled
 * matcher gets wrong quietly.
 *
 * Best-effort throughout: this augments the existing package-level signal and
 * must never be able to fail a scan. On any error the caller keeps the coarser
 * answer it already had, which is why every failure path returns an empty map
 * rather than throwing.
 */
import { httpRequest } from '../../core/http';

const HOST = 'api.osv.dev';
const URL = `https://${HOST}/v1/querybatch`;

/**
 * OSV accepts up to 1000 queries per batch. Chunked well under that: a resolved
 * tree for a large monorepo runs to thousands of packages, and a request that
 * large is slow enough to matter on a scheduled scan.
 */
const BATCH = 250;

/** How many batches run at once. Enough to be quick, small enough to be polite. */
const CONCURRENCY = 4;

export interface VersionQuery {
  name: string;
  version: string;
}

/** `name@version` — the key both this module and its callers index by. */
export function installKey(name: string, version: string): string {
  return `${name}@${version}`;
}

interface BatchResponse {
  results?: { vulns?: { id?: string }[] }[];
}

/**
 * Vulnerabilities affecting each exact (package, version).
 *
 * Returns a map keyed by `name@version` containing only the installs that are
 * actually affected — absent means "OSV knows of nothing for this version",
 * which is a real all-clear for the versions OSV covers.
 *
 * Callers must still treat a wholly empty result as "could not establish" when
 * the request failed, which is why `queryVulnerableInstalls` reports failure
 * separately rather than folding it into an empty map.
 */
export async function queryVulnerableInstalls(
  installs: VersionQuery[],
  fetchImpl?: typeof fetch,
): Promise<{ affected: Map<string, string[]>; complete: boolean }> {
  const affected = new Map<string, string[]>();
  if (installs.length === 0) return { affected, complete: true };

  // One query per distinct install. A tree repeats the same version constantly.
  const unique = [...new Map(installs.map((i) => [installKey(i.name, i.version), i])).values()];

  const batches: VersionQuery[][] = [];
  for (let i = 0; i < unique.length; i += BATCH) batches.push(unique.slice(i, i + BATCH));

  let complete = true;

  // Bounded concurrency by walking a shared cursor — no queue library for what
  // is four workers over an array.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (let i = cursor++; i < batches.length; i = cursor++) {
      const batch = batches[i]!;
      try {
        const { data } = await httpRequest<BatchResponse>(URL, {
          host: HOST,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            queries: batch.map((q) => ({
              version: q.version,
              package: { name: q.name, ecosystem: 'npm' },
            })),
          }),
          // Uncached on purpose. The shared cache keys on the URL, and every
          // batch here posts to the same one with a different body — a cache hit
          // would answer one tree's question with another tree's vulnerabilities.
          ttlMs: 0,
          // Best-effort by contract: the caller keeps its coarser answer when
          // this fails, so exhausting the default retry ladder would only stall
          // a scheduled scan behind an outage nobody is waiting on.
          retries: 1,
          fetchImpl,
        });
        // Results are positional — index i of the response answers query i.
        // A short array means the response is not the one we asked for, so
        // aligning what did arrive would attribute vulns to the wrong package.
        const results = data?.results ?? [];
        if (results.length !== batch.length) {
          complete = false;
          continue;
        }
        results.forEach((result, j) => {
          const ids = (result?.vulns ?? [])
            .map((v) => v?.id)
            .filter((id): id is string => typeof id === 'string');
          if (ids.length === 0) return;
          const q = batch[j]!;
          affected.set(installKey(q.name, q.version), ids);
        });
      } catch {
        // One failed batch does not invalidate the others, but it does mean the
        // answer is partial — and a partial vulnerability answer that claims to
        // be complete is the failure this whole module exists to prevent.
        complete = false;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  return { affected, complete };
}
