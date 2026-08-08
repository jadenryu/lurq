/**
 * Migration hop planning.
 *
 * Nobody upgrades react-router 6.9.2 → 8.1.0 in one edit. They go 6 → 7, get the
 * codebase green, then 7 → 8. The brief has to say that, because the ordering is
 * most of the work and a single 6→8 diff hides which breakage belongs to which
 * step.
 *
 * The hop list is NOT how breakage is decided. The direct `from → to` diff stays
 * authoritative for "will my code break": a symbol removed at 7 and restored at
 * 8 is not a breakage, and unioning per-hop removals would report it as one.
 * Hops answer a different question — *in what order do I do this* — and the two
 * are kept separate on purpose (see `briefUpgrade`).
 */
import semver from 'semver';

/** Hops past this are a rewrite, not an upgrade; the brief says so rather than
 *  fanning out a dozen surface extractions nobody will read. */
export const MAX_HOPS = 4;

/**
 * The highest non-prerelease release of each major between `from` and `to`.
 *
 * Prereleases are excluded throughout: `semver.maxSatisfying` with
 * `includePrerelease: false` is what an install resolves to, and routing a
 * migration through an alpha nobody shipped would be actively misleading.
 */
export function planHops(versions: string[], from: string, to: string): string[] {
  if (!semver.valid(from) || !semver.valid(to)) return [];
  if (!semver.gt(to, from)) return [];

  const fromMajor = semver.major(from);
  const toMajor = semver.major(to);
  // Same major, or adjacent majors: the direct diff already IS the single hop.
  if (toMajor - fromMajor < 2) return [];

  const stops: string[] = [];
  for (let major = fromMajor + 1; major < toMajor; major++) {
    const best = semver.maxSatisfying(versions, `${major}.x`, { includePrerelease: false });
    // A major with no known release is a gap in our version timeline, not a
    // major that does not exist. Skipping it silently would claim a shorter
    // migration than the real one, so the caller reports `truncated` instead.
    if (best) stops.push(best);
  }

  const path = [from, ...stops, to];
  return path.length > MAX_HOPS + 1 ? [] : path;
}

/** Consecutive pairs of a hop path — the diffs actually worth computing. */
export function hopPairs(path: string[]): { fromVersion: string; toVersion: string }[] {
  const pairs: { fromVersion: string; toVersion: string }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    pairs.push({ fromVersion: path[i]!, toVersion: path[i + 1]! });
  }
  return pairs;
}

/**
 * True when the majors between `from` and `to` exceed what we will plan.
 * Surfaced so the brief can say "too far to sequence" rather than quietly
 * presenting a one-shot diff as the whole story.
 */
export function tooFarToSequence(from: string, to: string): boolean {
  if (!semver.valid(from) || !semver.valid(to)) return false;
  return semver.major(to) - semver.major(from) > MAX_HOPS;
}
