/**
 * Surface diff (§8.1 `diff_surface`, §3 `removed_at` / `arity_changed`).
 *
 * The highest-value output in the spec and the cheapest: "when did this stop
 * working" falls out of a static comparison of two extracted surfaces, with no
 * oracle executed across a version matrix.
 *
 * Three guards, each for a defect that silently corrupted the study (§6.4):
 *   - cross-tier diffs are refused outright (§6.4.3)
 *   - `type_only` never counts as runtime breakage (§6.4.4)
 *   - `external:*` re-exports are never counted as this package's removals (§6.4.1)
 *
 * The fourth guard lives here too: a diff against an EMPTY surface is refused
 * (§6.4.2). An empty extraction is a measurement failure, and treating it as
 * "everything was removed" is exactly the bug that reported 100% precision on a
 * harness that had loaded nothing.
 */
import { runtimeSymbols, type ExtractedSurface, type SurfaceSymbol } from './types';

export interface ArityChange {
  path: string;
  from: number | null;
  to: number | null;
}

export interface SurfaceDiff {
  package: string;
  fromVersion: string | null;
  toVersion: string | null;
  tier: ExtractedSurface['tier'];
  /** Runtime symbols present in `from` and absent from `to`. Breaks `node`. */
  removed: SurfaceSymbol[];
  added: SurfaceSymbol[];
  arityChanged: ArityChange[];
  /** Type-level removals — break `tsc`, NOT `node`. Reported separately (§8.1). */
  typeOnlyRemoved: SurfaceSymbol[];
  deprecated: SurfaceSymbol[];
  /** Set when no comparison could be made; callers must not read the arrays. */
  inconclusive?: string;
}

const empty = (
  from: ExtractedSurface,
  to: ExtractedSurface,
  reason: string,
): SurfaceDiff => ({
  package: from.package,
  fromVersion: from.version,
  toVersion: to.version,
  tier: from.tier,
  removed: [],
  added: [],
  arityChanged: [],
  typeOnlyRemoved: [],
  deprecated: [],
  inconclusive: reason,
});

export function diffSurfaces(from: ExtractedSurface, to: ExtractedSurface): SurfaceDiff {
  // §6.4.3 — a tier-A surface and a tier-C surface are not comparable.
  if (from.tier !== to.tier) {
    return empty(from, to, `cross-tier comparison refused: ${from.tier} vs ${to.tier}`);
  }
  // §6.4.2 — never issue a verdict from an empty surface. Mandatory guard.
  if (from.symbols.length === 0) {
    return empty(from, to, 'source surface is empty — extraction failed, not a removal');
  }
  if (to.symbols.length === 0) {
    return empty(from, to, 'target surface is empty — extraction failed, not a removal');
  }

  const fromRuntime = new Map(runtimeSymbols(from).map((s) => [s.path, s]));
  const toRuntime = new Map(runtimeSymbols(to).map((s) => [s.path, s]));

  const removed = [...fromRuntime.values()].filter((s) => !toRuntime.has(s.path));
  const added = [...toRuntime.values()].filter((s) => !fromRuntime.has(s.path));

  const arityChanged: ArityChange[] = [];
  for (const [path, a] of fromRuntime) {
    const b = toRuntime.get(path);
    if (!b) continue;
    if (a.arity !== null && b.arity !== null && a.arity !== b.arity) {
      arityChanged.push({ path, from: a.arity, to: b.arity });
    }
  }

  // §6.4.4 — reported, but as a separate class so a caller can tell a `tsc`
  // break from a `node` break.
  const typeOnlyFrom = from.symbols.filter((s) => s.kind === 'type_only');
  const toPaths = new Set(to.symbols.map((s) => s.path));
  const typeOnlyRemoved = typeOnlyFrom.filter((s) => !toPaths.has(s.path));

  const deprecated = [...toRuntime.values()].filter(
    (s) => s.deprecated && !fromRuntime.get(s.path)?.deprecated,
  );

  return {
    package: from.package,
    fromVersion: from.version,
    toVersion: to.version,
    tier: from.tier,
    removed,
    added,
    arityChanged,
    typeOnlyRemoved,
    deprecated,
  };
}

/** Severity for reporting: runtime removals only, matching the study's metric. */
export function removalCount(diff: SurfaceDiff): number {
  return diff.inconclusive ? 0 : diff.removed.length;
}
