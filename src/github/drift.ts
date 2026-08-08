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
  TRANSITIVE_DETAIL_CAP,
  type DepDeclaration,
  type DepDrift,
  type RepoDrift,
  type RepoManifest,
  type TransitiveDrift,
  type TransitiveRisk,
} from './types';
import { buildAttribution } from './attribute';
import { assembleMembers } from '../compat/members';
import { resolveArchitectureCompat } from '../compat/peerCompat';
import type { CompatConflict } from '../core/types';
import type { DependencyEdge, ResolvedDep } from './sbom';

/** Postgres caps bind parameters; chunk the `IN` lists well under it. */
const NAME_CHUNK = 500;

interface IndexedPackage {
  latestVersion: string | null;
  deprecated: boolean;
  advisories: number;
}

export interface DeclaredDep {
  /** Lowest range declared anywhere — see below. */
  range: string;
  /** Every manifest that declares it, in manifest order (root first). */
  declaredIn: DepDeclaration[];
}

/**
 * Distinct dependencies across every manifest, with where each is declared.
 *
 * `range` is the *lowest* declared range, because that is the one whose upgrade
 * is furthest away and therefore governs the repo's real drift. `declaredIn`
 * keeps every site, because reporting drift and *editing* it need different
 * views: the merged range answers "how far behind is this repo", the file list
 * answers "which package.json does the agent bump".
 */
export function declaredDeps(manifests: RepoManifest[]): Map<string, DeclaredDep> {
  const out = new Map<string, DeclaredDep>();
  for (const manifest of manifests) {
    for (const [name, range] of Object.entries(manifest.deps)) {
      const existing = out.get(name);
      if (!existing) {
        out.set(name, { range, declaredIn: [{ path: manifest.path, range }] });
        continue;
      }
      existing.declaredIn.push({ path: manifest.path, range });
      const current = semver.minVersion(existing.range);
      const candidate = semver.minVersion(range);
      if (current && candidate && semver.lt(candidate, current)) existing.range = range;
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
export async function loadVersions(
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
  declared: DeclaredDep,
  indexed: IndexedPackage,
  knownVersions: string[],
): DepDrift {
  const { range } = declared;
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
    declaredIn: declared.declaredIn,
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

/**
 * Risk in the resolved tree, excluding what the manifest already declares.
 *
 * Deliberately reports *presence of advisories on the package*, not "vulnerable
 * install": lurq stores advisories without affected-version ranges, so claiming
 * a specific resolved version is affected would be an inference we cannot back.
 * `advisoryPackages` is named for what it actually counts.
 */
export async function computeTransitiveDrift(
  db: Database,
  resolved: ResolvedDep[],
  directNames: Set<string>,
  truncated: boolean,
  edges: DependencyEdge[] = [],
): Promise<TransitiveDrift> {
  const transitives = resolved.filter((dep) => !directNames.has(dep.name));
  const attribution = buildAttribution(resolved, edges, directNames);
  const empty: TransitiveDrift = {
    resolved: transitives.length,
    tracked: 0,
    advisoryPackages: 0,
    deprecated: 0,
    risks: [],
    truncated,
    attributed: attribution.available,
  };
  if (transitives.length === 0) return empty;

  const indexed = await loadIndexed(db, [...new Set(transitives.map((d) => d.name))]);

  const risks: TransitiveRisk[] = [];
  let tracked = 0;
  for (const dep of transitives) {
    const row = indexed.get(dep.name);
    if (!row) continue; // untracked — no signal either way, never counted as clean
    tracked++;
    if (row.advisories === 0 && !row.deprecated) continue;
    risks.push({
      name: dep.name,
      version: dep.version,
      latest: row.latestVersion,
      advisories: row.advisories,
      deprecated: row.deprecated,
      pulledInBy: attribution.parentsOf.get(dep.name) ?? [],
    });
  }

  // Advisories outrank deprecation: one is a security signal, the other is a
  // maintenance one, and a capped list should keep the former.
  risks.sort(
    (a, b) =>
      b.advisories - a.advisories ||
      Number(b.deprecated) - Number(a.deprecated) ||
      a.name.localeCompare(b.name),
  );

  return {
    resolved: transitives.length,
    tracked,
    advisoryPackages: risks.filter((r) => r.advisories > 0).length,
    deprecated: risks.filter((r) => r.deprecated).length,
    risks: risks.slice(0, TRANSITIVE_DETAIL_CAP),
    truncated,
    attributed: attribution.available,
  };
}

/**
 * Peer/engine conflicts across the repo's tracked dependencies, evaluated at the
 * versions the index calls latest.
 *
 * Names are passed without pins on purpose. `assembleMembers` reads peers and
 * engines straight from the index for an unpinned name, so this costs one query;
 * pinning each dependency to its *resolved* version would instead fetch that
 * exact manifest from npm, one request per dependency, on every nightly scan of
 * every repo. The unpinned question is also the more useful one here — the
 * dashboard's job is to say whether the upgrades it is recommending land on a
 * stack that holds together.
 *
 * Capped like `deps`, and for a sharper reason. `resolveArchitectureCompat` emits
 * one conflict per PAIR of requirers of the same unpinned peer, so its output is
 * quadratic in that group's size. Its other caller is `compat`, which passes 2-5
 * packages; a repo passes every tracked direct dependency, and fifty plugins
 * disagreeing about one uninstalled peer is 1,225 rows. This result is persisted
 * whole into the `drift` JSONB column and re-served on every dashboard load, so
 * an unbounded array here is unbounded storage and an unbounded response.
 *
 * ponytail: conflicts in the CURRENT install (pinned versions) are the other half
 * and are not computed. Add them when the registry read can be amortised — a
 * `package_versions`-level peer/engine column would make it another single query.
 */
async function conflictsAtLatest(
  db: Database,
  names: string[],
): Promise<CompatConflict[]> {
  if (names.length === 0) return [];
  const { members } = await assembleMembers(db, names);
  return resolveArchitectureCompat(members).slice(0, REPO_DRIFT_DETAIL_CAP);
}

/** Compute a repo's full drift summary from its manifests. */
export async function computeDrift(
  db: Database,
  manifests: RepoManifest[],
  resolvedTree: { deps: ResolvedDep[]; edges: DependencyEdge[]; truncated: boolean } | null = null,
): Promise<RepoDrift> {
  const declared = declaredDeps(manifests);
  const names = [...declared.keys()];
  const directNames = new Set(names);
  const transitive = resolvedTree
    ? await computeTransitiveDrift(
        db,
        resolvedTree.deps,
        directNames,
        resolvedTree.truncated,
        resolvedTree.edges,
      )
    : null;

  if (names.length === 0) {
    return {
      depsDeclared: 0,
      depsTracked: 0,
      majorDrift: 0,
      anyDrift: 0,
      deprecated: 0,
      advisories: 0,
      deps: [],
      transitive,
      conflictsAtLatest: [],
    };
  }

  const [indexed, versions] = await Promise.all([
    loadIndexed(db, names),
    loadVersions(db, names),
  ]);

  const deps: DepDrift[] = [];
  for (const [name, entry] of declared) {
    const row = indexed.get(name);
    if (!row) continue; // untracked — counted via depsDeclared - depsTracked
    deps.push(depDrift(name, entry, row, versions.get(name) ?? []));
  }

  deps.sort((a, b) => severity(b) - severity(a) || a.name.localeCompare(b.name));

  // Tracked names only. An untracked one would send `assembleMembers` to the npm
  // registry for its manifest, turning a one-query check into one request per
  // unindexed dependency on every scan.
  const conflicts = await conflictsAtLatest(db, deps.map((d) => d.name));

  return {
    depsDeclared: declared.size,
    depsTracked: deps.length,
    majorDrift: deps.filter((d) => d.majorsBehind > 0).length,
    anyDrift: deps.filter(isBehind).length,
    deprecated: deps.filter((d) => d.deprecated).length,
    advisories: deps.reduce((sum, d) => sum + d.advisories, 0),
    deps: deps.slice(0, REPO_DRIFT_DETAIL_CAP),
    transitive,
    conflictsAtLatest: conflicts,
  };
}
