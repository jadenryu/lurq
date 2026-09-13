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
  /** Most arguments accepted on each side, when both were measured. */
  fromMax?: number | null;
  toMax?: number | null;
}

export interface SignatureChange {
  path: string;
  from: string;
  to: string;
}

export interface Rename {
  path: string;
  /** Names the same declaration was also exported under at `from`, and that
   *  `to` still exports. */
  to: string[];
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
  /** Signature drift. Tier C only — tier A cannot see types at all, so an empty
   *  list from a tier-A diff means "not measurable", not "nothing changed". */
  signatureChanged: SignatureChange[];
  /** Type-level removals — break `tsc`, NOT `node`. Reported separately (§8.1). */
  typeOnlyRemoved: SurfaceSymbol[];
  deprecated: SurfaceSymbol[];
  /**
   * Removed symbols whose implementation survives under another name.
   *
   * Not a guess from similar names. At `from`, both names were exported from the
   * same declaration, and `to` still exports the other one. cookie 1 → 2
   * (`parse` → `parseCookie`) and zod 3 → 4 (`ZodSchema` → `ZodType`) are this
   * shape. Empty means "no proof", not "no rename": a rename that shipped in a
   * single release leaves no alias behind to find.
   */
  renamed: Rename[];
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
  signatureChanged: [],
  typeOnlyRemoved: [],
  deprecated: [],
  renamed: [],
  inconclusive: reason,
});

export function diffSurfaces(from: ExtractedSurface, to: ExtractedSurface): SurfaceDiff {
  // §6.4.3 — a tier-A surface and a tier-C surface are not comparable.
  if (from.tier !== to.tier) {
    return empty(from, to, `cross-tier comparison refused: ${from.tier} vs ${to.tier}`);
  }
  // §6.4.2 — never issue a verdict from an empty surface. Mandatory guard.
  if (from.symbols.length === 0) {
    return empty(from, to, 'source surface is empty, extraction failed, not a removal');
  }
  if (to.symbols.length === 0) {
    return empty(from, to, 'target surface is empty, extraction failed, not a removal');
  }

  const fromRuntime = new Map(runtimeSymbols(from).map((s) => [s.path, s]));
  const toRuntime = new Map(runtimeSymbols(to).map((s) => [s.path, s]));

  // Present in `to` means exported by it, from anywhere: a name the new version
  // re-exports from another package is still importable. Only the FROM side
  // excludes external names, so this package is never charged with removing
  // what it never owned (§6.4.1).
  const toPresent = new Set(to.symbols.filter((s) => s.kind !== 'type_only').map((s) => s.path));
  const removed = [...fromRuntime.values()].filter((s) => !toPresent.has(s.path));
  const added = [...toRuntime.values()].filter((s) => !fromRuntime.has(s.path));

  const arityChanged: ArityChange[] = [];
  for (const [path, a] of fromRuntime) {
    const b = toRuntime.get(path);
    if (!b) continue;
    const requiredChanged = a.arity !== null && b.arity !== null && a.arity !== b.arity;
    // Dropping a trailing optional parameter leaves `fn.length` alone and still
    // breaks every caller that passes it. Gaining one breaks nobody, and neither
    // does trading `arguments` for named parameters, so only a numeric maximum
    // that shrank counts. `check-release` reads this list as "needs a major".
    const measured = a.maxArity !== undefined && b.maxArity !== undefined;
    const maxShrank =
      typeof a.maxArity === 'number' && typeof b.maxArity === 'number' && b.maxArity < a.maxArity;
    if (requiredChanged || maxShrank) {
      arityChanged.push({
        path,
        from: a.arity,
        to: b.arity,
        ...(measured ? { fromMax: a.maxArity, toMax: b.maxArity } : {}),
      });
    }
  }

  // §6.4.4 — reported, but as a separate class so a caller can tell a `tsc`
  // break from a `node` break.
  const typeOnlyFrom = from.symbols.filter((s) => s.kind === 'type_only');
  const toPaths = new Set(to.symbols.map((s) => s.path));
  const typeOnlyRemoved = typeOnlyFrom.filter((s) => !toPaths.has(s.path));

  // Signatures exist only at tier C. Comparing them on a tier-A diff would
  // report "no changes" for something never measured.
  const signatureChanged: SignatureChange[] = [];
  if (from.tier === 'bundled_dts') {
    const fromAll = new Map(from.symbols.map((s) => [s.path, s]));
    for (const b of to.symbols) {
      const a = fromAll.get(b.path);
      if (a?.signature && b.signature && a.signature !== b.signature) {
        signatureChanged.push({ path: b.path, from: a.signature, to: b.signature });
      }
    }
  }

  const deprecated = [...toRuntime.values()].filter(
    (s) => s.deprecated && !fromRuntime.get(s.path)?.deprecated,
  );

  // Keyed on offset, never line: preact's minified bundle declares twelve
  // exports on line 1, and matching by line would call `render` a rename of `h`.
  const declKey = (s: SurfaceSymbol) =>
    s.sourceRef?.offset === undefined ? null : `${s.sourceRef.file}#${s.sourceRef.offset}`;
  const renamed: Rename[] = [];
  for (const r of removed) {
    const key = declKey(r);
    if (key === null) continue;
    const survivors = [...fromRuntime.values()]
      .filter((s) => s.path !== r.path && toRuntime.has(s.path) && declKey(s) === key)
      .map((s) => s.path);
    if (survivors.length) renamed.push({ path: r.path, to: survivors });
  }

  return {
    package: from.package,
    fromVersion: from.version,
    toVersion: to.version,
    tier: from.tier,
    removed,
    added,
    arityChanged,
    signatureChanged,
    typeOnlyRemoved,
    deprecated,
    renamed,
  };
}
