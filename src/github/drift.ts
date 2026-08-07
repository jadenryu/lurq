/**
 * Drift computation: declared ranges → how far behind this repo actually is.
 *
 * "Behind" is measured against what a *fresh install today* would resolve to,
 * not against the range's floor. `^6.4.0` on a package now at 6.9.2 is current,
 * not five minors behind — reporting it as drift is how a dashboard trains its
 * user to ignore it. So `resolved` is `maxSatisfying(range)` and drift is the
 * gap from there to `latest`.
 *
 * Anything the index does not know stays out of the drift counts entirely and is
 * reported as `depsDeclared - depsTracked`. Same discipline as `unverified` in
 * src/surface/upgrade.ts: a dependency we did not look at must never be counted
 * as one we found nothing wrong with.
 */
import { inArray } from 'drizzle-orm';
import semver from 'semver';
import type { Database } from '../db/client';
import { packageVersions, packages } from '../db/schema';
import {
  REPO_DRIFT_DETAIL_CAP,
  type DepDrift,
  type RepoDrift,
  type RepoManifest,
} from './types';

/** Postgres caps bind parameters; chunk the `IN` lists well under it. */
const NAME_CHUNK = 500;

interface IndexedPackage {
  latestVersion: string | null;
  deprecated: boolean;
  advisories: number;
}

/** Distinct dependency names across every manifest in a repo. */
export function declaredDeps(manifests: RepoManifest[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const manifest of manifests) {
    for (const [name, range] of Object.entries(manifest.deps)) {
      // A workspace can pin a different range than the root. Keep the *lowest*
      // declared range, because that is the one whose upgrade is furthest away
      // and therefore the one that governs the repo's real drift.
      const existing = out.get(name);
      if (!existing) {
        out.set(name, range);
        continue;
      }
      const a = semver.minVersion(existing);
      const b = semver.minVersion(range);
      if (a && b && semver.lt(b, a)) out.set(name, range);
    }
  }
  return out;
}

async function loadIndexed(
  db: Database,
  names: string[],
): Promise<Map<string, IndexedPackage>> {
  const out = new Map<string, IndexedPackage>();
  for (let i = 0; i < names.length; i += NAME_CHUNK) {
    const rows = await db
      .select({
        name: packages.name,
        latestVersion: packages.latestVersion,
        deprecated: packages.deprecated,
        advisories: packages.advisories,
      })
      .from(packages)
      .where(inArray(packages.name, names.slice(i, i + NAME_CHUNK)));
    for (const row of rows) {
      out.set(row.name, {
        latestVersion: row.latestVersion,
        deprecated: row.deprecated,
        advisories: row.advisories?.length ?? 0,
      });
    }
  }
  return out;
}

/**
 * Versions the index knows for each name, so `maxSatisfying` answers what a real
 * install would pick rather than assuming the range's floor.
 *
 * Deliberately one query per chunk of names rather than per name: a repo with
 * 300 dependencies would otherwise open 300 round trips per scan.
 */
async function loadVersions(
  db: Database,
  names: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < names.length; i += NAME_CHUNK) {
    const rows = await db
      .select({ name: packageVersions.packageName, version: packageVersions.version })
      .from(packageVersions)
      .where(inArray(packageVersions.packageName, names.slice(i, i + NAME_CHUNK)));
    for (const row of rows) {
      const list = out.get(row.name);
      if (list) list.push(row.version);
      else out.set(row.name, [row.version]);
    }
  }
  return out;
}

/** Pure drift math for one dependency — the part worth testing in isolation. */
export function depDrift(
  name: string,
  range: string,
  indexed: IndexedPackage,
  knownVersions: string[],
): DepDrift {
  const latest = indexed.latestVersion;
  // `maxSatisfying` needs the candidate list; when the index has no timeline yet,
  // fall back to the range's own floor rather than reporting no drift at all.
  const resolved =
    semver.maxSatisfying(knownVersions, range, { includePrerelease: false }) ??
    semver.minVersion(range)?.version ??
    null;

  let majorsBehind = 0;
  if (resolved && latest && semver.valid(resolved) && semver.valid(latest)) {
    majorsBehind = Math.max(0, semver.major(latest) - semver.major(resolved));
  }

  return {
    name,
    range,
    resolved,
    latest,
    majorsBehind,
    deprecated: indexed.deprecated,
    advisories: indexed.advisories,
  };
}

/** True when `resolved` is behind `latest` at any semver level. */
function isBehind(dep: DepDrift): boolean {
  if (!dep.resolved || !dep.latest) return false;
  if (!semver.valid(dep.resolved) || !semver.valid(dep.latest)) return false;
  return semver.lt(dep.resolved, dep.latest);
}

/**
 * Rank worst-first so the capped detail list keeps what matters: an advisory
 * outranks a major bump, which outranks a deprecation notice, which outranks a
 * minor. The summary counts above the list are always exact regardless of the cap.
 */
function severity(dep: DepDrift): number {
  return (
    dep.advisories * 1000 +
    dep.majorsBehind * 100 +
    (dep.deprecated ? 50 : 0) +
    (isBehind(dep) ? 1 : 0)
  );
}

/** Compute a repo's full drift summary from its manifests. */
export async function computeDrift(
  db: Database,
  manifests: RepoManifest[],
): Promise<RepoDrift> {
  const declared = declaredDeps(manifests);
  const names = [...declared.keys()];
  if (names.length === 0) {
    return {
      depsDeclared: 0,
      depsTracked: 0,
      majorDrift: 0,
      anyDrift: 0,
      deprecated: 0,
      advisories: 0,
      deps: [],
    };
  }

  const [indexed, versions] = await Promise.all([
    loadIndexed(db, names),
    loadVersions(db, names),
  ]);

  const deps: DepDrift[] = [];
  for (const [name, range] of declared) {
    const row = indexed.get(name);
    if (!row) continue; // untracked — counted via depsDeclared - depsTracked
    deps.push(depDrift(name, range, row, versions.get(name) ?? []));
  }

  deps.sort((a, b) => severity(b) - severity(a) || a.name.localeCompare(b.name));

  return {
    depsDeclared: declared.size,
    depsTracked: deps.length,
    majorDrift: deps.filter((d) => d.majorsBehind > 0).length,
    anyDrift: deps.filter(isBehind).length,
    deprecated: deps.filter((d) => d.deprecated).length,
    advisories: deps.reduce((sum, d) => sum + d.advisories, 0),
    deps: deps.slice(0, REPO_DRIFT_DETAIL_CAP),
  };
}
