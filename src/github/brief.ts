/**
 * Migration brief: for each dependency a repo is behind on, what does the
 * upgrade actually remove from the public API?
 *
 * This is the half of the answer that can be computed without the source. It
 * says "react-router 6.9.2 → 8.1.0 removes 14 runtime exports", which is a fact
 * about the packages. It deliberately does NOT say "this breaks your code" —
 * that requires knowing which of those 14 the repo references, and the reference
 * scan runs in the user's own CI where the source already is. The CI half feeds
 * the same symbols into `checkUpgradeOne` (src/surface/upgrade.ts) to narrow
 * `removesExports` down to `symbolsRemoved`.
 *
 * Wording matters here and is load-bearing: a brief that overclaims once gets
 * the whole gate switched off (§12 M3). Every field name says what was measured.
 */
import type { Database } from '../db/client';
import { handleDiffSurface } from '../mcp/surfaceHandlers';
import { loadVersions } from './drift';
import { hopPairs, planHops, tooFarToSequence } from './hops';
import type { DepDeclaration, DepDrift, RepoDrift } from './types';

/**
 * What the diff established about an upgrade.
 *   `removes-exports` — runtime exports disappear. Whether THIS repo calls them
 *                       is the CI half; on its own this is a real hazard signal.
 *   `arity-changed`   — nothing removed, but a signature took a different count.
 *   `clean`           — surfaces compared, nothing removed or re-shaped.
 *   `unknown`         — one or both surfaces are not extracted yet. Queued by the
 *                       diff call itself. NEVER folded into `clean`.
 */
export type UpgradeVerdict = 'removes-exports' | 'arity-changed' | 'clean' | 'unknown';

/** One step of a multi-major migration. */
export interface UpgradeHop {
  fromVersion: string;
  toVersion: string;
  verdict: UpgradeVerdict;
  removed: string[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
}

export interface UpgradeBrief {
  package: string;
  fromVersion: string;
  toVersion: string;
  /**
   * Every manifest declaring this package. A monorepo needs all of them: bumping
   * only the root leaves the workspace pinned to the old major and the upgrade
   * half-applied, which typechecks locally and breaks on install.
   */
  declaredIn: DepDeclaration[];
  majorsBehind: number;
  advisories: number;
  deprecated: boolean;
  verdict: UpgradeVerdict;
  /** Runtime exports present in `from` and gone in `to`. */
  removed: string[];
  /** Exports whose parameter count changed — silent misbehaviour, not a crash. */
  arityChanged: { path: string; from: number | null; to: number | null }[];
  /** Removed type-only exports. Breaks `tsc`, never `node` — separated on purpose. */
  typeOnlyRemoved: string[];
  /** Exports newly marked `@deprecated` at the target version. */
  newlyDeprecated: string[];
  /** Why the answer is `unknown`, when it is. */
  inconclusive?: string;
  /**
   * The migration sequence, when the upgrade crosses two or more majors. Empty
   * for a single-major bump, where the direct diff already is the only hop.
   *
   * These do NOT determine breakage — the fields above do, from the direct
   * from→to diff. A symbol dropped at 7 and restored at 8 appears in a hop and
   * correctly does not appear in `removed`.
   */
  hops: UpgradeHop[];
  /** Set when the sequence could not be planned, and why. Never left implicit:
   *  an absent hop list would otherwise read as "this is a one-step upgrade". */
  sequenceNote?: string;
}

export interface RepoBrief {
  upgrades: UpgradeBrief[];
  /** Drifted deps not briefed because of the cap — reported, never silent. */
  omitted: number;
  /** Upgrades whose surfaces are still being extracted. */
  pending: number;
}

/** Diffs per brief. Each is two indexed reads, but a 200-dep monorepo would
 *  otherwise fan out to 200 of them on a page load. */
export const BRIEF_CAP = 25;

/** Deps worth briefing: something changed between what they run and what's current. */
function briefable(dep: DepDrift): boolean {
  return Boolean(dep.resolved && dep.latest && dep.resolved !== dep.latest);
}

/**
 * Rank by consequence, so a cap keeps what matters. Advisories first — an
 * upgrade you must do outranks one you might want to.
 */
function rank(dep: DepDrift): number {
  return dep.advisories * 1000 + dep.majorsBehind * 100 + (dep.deprecated ? 50 : 0);
}

function verdictOf(
  removed: string[],
  arityChanged: unknown[],
  inconclusive: string | undefined,
): UpgradeVerdict {
  if (inconclusive) return 'unknown';
  if (removed.length > 0) return 'removes-exports';
  if (arityChanged.length > 0) return 'arity-changed';
  return 'clean';
}

/** Brief one upgrade. Reuses the `diff_surface` handler so there is exactly one
 *  implementation of the diff — including its enqueue-on-miss behaviour. */
export async function briefUpgrade(
  db: Database,
  dep: DepDrift,
  knownVersions: string[] = [],
): Promise<UpgradeBrief> {
  const base = {
    package: dep.name,
    fromVersion: dep.resolved!,
    toVersion: dep.latest!,
    declaredIn: dep.declaredIn,
    majorsBehind: dep.majorsBehind,
    advisories: dep.advisories,
    deprecated: dep.deprecated,
  };

  // The direct diff is authoritative for breakage. Hops below are sequencing.
  const diff = await handleDiffSurface(db, {
    package: dep.name,
    fromVersion: base.fromVersion,
    toVersion: base.toVersion,
  });

  const removed = diff.removed.map((s) => s.path);
  const inconclusive = 'inconclusive' in diff ? (diff.inconclusive as string) : undefined;

  const { hops, sequenceNote } = await planSequence(db, dep, base, knownVersions);

  return {
    ...base,
    verdict: verdictOf(removed, diff.arityChanged, inconclusive),
    removed,
    arityChanged: diff.arityChanged,
    typeOnlyRemoved: diff.typeOnlyRemoved,
    newlyDeprecated: diff.deprecated ?? [],
    hops,
    ...(inconclusive ? { inconclusive } : {}),
    ...(sequenceNote ? { sequenceNote } : {}),
  };
}

/** Diff each step of a multi-major migration, so the work can be ordered. */
async function planSequence(
  db: Database,
  dep: DepDrift,
  base: { fromVersion: string; toVersion: string },
  knownVersions: string[],
): Promise<{ hops: UpgradeHop[]; sequenceNote?: string }> {
  if (dep.majorsBehind < 2) return { hops: [] };

  if (tooFarToSequence(base.fromVersion, base.toVersion)) {
    return {
      hops: [],
      sequenceNote: `${dep.majorsBehind} majors behind — too far to sequence automatically. Treat this as a migration, not an upgrade.`,
    };
  }

  const path = planHops(knownVersions, base.fromVersion, base.toVersion);
  if (path.length === 0) {
    return {
      hops: [],
      sequenceNote: 'Intermediate releases are missing from the index, so the hop sequence could not be planned.',
    };
  }

  const hops: UpgradeHop[] = [];
  for (const pair of hopPairs(path)) {
    const hopDiff = await handleDiffSurface(db, { package: dep.name, ...pair });
    const hopRemoved = hopDiff.removed.map((s) => s.path);
    hops.push({
      ...pair,
      verdict: verdictOf(
        hopRemoved,
        hopDiff.arityChanged,
        'inconclusive' in hopDiff ? (hopDiff.inconclusive as string) : undefined,
      ),
      removed: hopRemoved,
      arityChanged: hopDiff.arityChanged,
    });
  }
  return { hops };
}

/** Brief a repo's outstanding upgrades, worst-first. */
export async function briefRepo(
  db: Database,
  drift: RepoDrift | null,
  limit = BRIEF_CAP,
): Promise<RepoBrief> {
  if (!drift) return { upgrades: [], omitted: 0, pending: 0 };

  const candidates = drift.deps.filter(briefable).sort((a, b) => rank(b) - rank(a));
  const selected = candidates.slice(0, Math.min(limit, BRIEF_CAP));

  // Sequential: each diff can enqueue an extraction, and a burst of parallel
  // misses on a fresh repo would queue the same specs from several callers at
  // once. There is no user-visible latency budget on a brief.
  // One version query for the whole brief rather than one per upgrade: hop
  // planning needs each package's release timeline, and 25 round trips on a
  // page load is the kind of cost that only shows up under real accounts.
  const versions = await loadVersions(db, selected.map((d) => d.name));

  const upgrades: UpgradeBrief[] = [];
  for (const dep of selected) {
    upgrades.push(await briefUpgrade(db, dep, versions.get(dep.name) ?? []));
  }

  // Hazards first, then unknowns — an unextracted surface should sit above a
  // clean one, because "we haven't looked" is a more actionable state than "fine".
  const order: Record<UpgradeVerdict, number> = {
    'removes-exports': 0,
    'arity-changed': 1,
    unknown: 2,
    clean: 3,
  };
  upgrades.sort(
    (a, b) => order[a.verdict] - order[b.verdict] || b.removed.length - a.removed.length,
  );

  return {
    upgrades,
    omitted: candidates.length - selected.length,
    pending: upgrades.filter((u) => u.verdict === 'unknown').length,
  };
}
