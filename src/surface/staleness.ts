/**
 * What an agent believes about your dependencies that is no longer true.
 *
 * The question every other part of lurq asks is "what breaks if I upgrade".
 * This one runs the comparison the other way, against a date instead of a
 * version: take the API that was current when a model's knowledge stops being
 * reliable, and subtract the API you actually have installed. What is left is
 * the set of symbols the agent will reach for and not find.
 *
 * It needs no source code and no CI. Both surfaces are already extracted and
 * immutable, and the version timeline is already stored with publish dates —
 * this is a query over facts lurq collected for other reasons.
 */
import type { Database } from '../db/client';
import { getPackageVersions } from '../db/packages';
import { handleDiffSurface } from '../mcp/surfaceHandlers';

export interface StaleBelief {
  package: string;
  /** What was current at the cutoff — what the model learned. */
  believed: string;
  /** What the project resolves today. */
  installed: string;
  /** Exported at `believed`, gone at `installed`. Names only — this is read by a human. */
  removed: string[];
  /**
   * Removed names the package itself proves a replacement for. The agent is
   * wrong about these too, but they are the cheap fixes.
   */
  renamed: { from: string; to: string[] }[];
}

export interface StalenessReport {
  since: string;
  beliefs: StaleBelief[];
  /** Packages whose surfaces are not both extracted, so nothing can be claimed. */
  unassessed: string[];
  /** Packages with no version published on or before the cutoff — the model never saw them. */
  newerThanModel: string[];
}

/**
 * The version a model trained to `isoDate` would have learned.
 *
 * Highest semver among the versions published on or before the cutoff, not
 * simply the most recently published one: a patch to an old major can land
 * after a new major shipped, and taking it would claim the model learned an API
 * that was already superseded when it trained.
 *
 * Prereleases are excluded. A model's knowledge of a package comes
 * overwhelmingly from docs, articles and code written against stable releases.
 */
export function versionAtDate(
  versions: { version: string; publishedAt: Date | null }[],
  isoDate: string,
): string | null {
  const cutoff = Date.parse(`${isoDate}T23:59:59Z`);
  if (Number.isNaN(cutoff)) return null;
  const eligible = versions.filter(
    (v) => v.publishedAt !== null && v.publishedAt.getTime() <= cutoff && !v.version.includes('-'),
  );
  if (eligible.length === 0) return null;
  return (
    eligible
      .map((v) => v.version)
      .sort(compareSemver)
      .at(-1) ?? null
  );
}

/** Ascending semver. Non-numeric or short versions sort low rather than throwing. */
function compareSemver(a: string, b: string): number {
  const parts = (v: string) => {
    const nums = v.split('.').map((n) => Number.parseInt(n, 10));
    return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0].map((n) => (Number.isNaN(n) ? 0 : n));
  };
  const [aMajor, aMinor, aPatch] = parts(a);
  const [bMajor, bMinor, bPatch] = parts(b);
  return aMajor! - bMajor! || aMinor! - bMinor! || aPatch! - bPatch!;
}

/**
 * Compare each dependency's installed surface against the one its model-era
 * version exported.
 *
 * Sequential, like `briefRepo`, and for the same reason: a diff can enqueue an
 * extraction, and a burst of parallel misses would queue the same specs several
 * times over.
 */
export async function staleBeliefs(
  db: Database,
  installed: { name: string; version: string }[],
  since: string,
): Promise<StalenessReport> {
  const beliefs: StaleBelief[] = [];
  const unassessed: string[] = [];
  const newerThanModel: string[] = [];

  for (const dep of installed) {
    const believed = versionAtDate(await getPackageVersions(db, dep.name, 500), since);
    if (!believed) {
      newerThanModel.push(dep.name);
      continue;
    }
    // Same version: the model learned what you have, so there is nothing to be
    // wrong about — not a finding, and not an omission either.
    if (believed === dep.version) continue;

    const diff = await handleDiffSurface(db, {
      package: dep.name,
      fromVersion: believed,
      toVersion: dep.version,
    });
    if (diff.verdict === 'unknown') {
      unassessed.push(dep.name);
      continue;
    }
    if (diff.removed.length === 0) continue;

    beliefs.push({
      package: dep.name,
      believed,
      installed: dep.version,
      // The diff carries kind and arity per symbol; this report is a list of
      // names a person reads, so it keeps the path and drops the rest.
      removed: diff.removed.map((r) => r.path),
      renamed: (diff.renamed ?? []).map((r) => ({ from: r.path, to: r.to })),
    });
  }

  // Worst first: the package the agent will be wrong about most often.
  beliefs.sort((a, b) => b.removed.length - a.removed.length);
  return { since, beliefs, unassessed, newerThanModel };
}

/** Total symbols the agent is wrong about — the headline number. */
export function staleSymbolCount(report: StalenessReport): number {
  return report.beliefs.reduce((n, b) => n + b.removed.length, 0);
}
