/**
 * `check_upgrade` (§8.1) — the team product's core call, and the first surface
 * with a plausible payer.
 *
 * The wedge, stated exactly: *Renovate and Dependabot catch what your tests
 * cover; lurq catches what your code references.* Existing tooling gates an
 * upgrade on a test suite, so if coverage misses the affected path the PR merges
 * green and breaks in production. This check needs no tests at all — it compares
 * the symbols the codebase actually references against the runtime surface of
 * the target version.
 *
 * Severity is deliberately blunt:
 *   BLOCKING — a referenced symbol disappears. The code will throw.
 *   WARNING  — a referenced symbol changed arity. It may silently misbehave.
 *   OK       — nothing referenced is affected.
 *
 * Anything we could not establish is `unverified`, never folded into OK. A check
 * that reports "safe" when it simply did not look is worse than no check, and it
 * is how a CI gate loses its credibility in one incident.
 */
import semver from 'semver';
import { extractUnpacked, fetchManifest, unpackPackage, type Unpacked } from './fetch';
import { diffSurfaces, type ArityChange } from './diff';
import { SURFACE_CLAIM_KINDS } from './references';
import type { PackageReferences, SymbolReference } from './references';
import {
  judgeRequirements,
  judgeRequires,
  readRepoRuntime,
  type RepoRuntime,
  type RequireBreak,
  type Requirement,
} from './requirements';
import { readManifest, requireTarget, resolveEntryCandidates, subpathWithdrawn } from './resolve';
import type { TypeCheck, TypeCheckFn, TypeDiagnostic } from './typecheck';
import { runtimeSymbols, starReExports, type ExtractedSurface, type SymbolKind } from './types';

export interface UpgradeTarget {
  package: string;
  fromVersion: string;
  toVersion: string;
}

export interface BreakingFinding {
  package: string;
  fromVersion: string;
  toVersion: string;
  severity: 'blocking' | 'warning';
  /** Referenced symbols removed at the target version. `specifier` names the
   *  entry point they were imported from. Absent means the package root. */
  symbolsRemoved: {
    symbol: string;
    specifier?: string;
    /** The replacement, when the package proves one: at `fromVersion` the removed
     *  name and these were exported from the same declaration. See `diff.renamed`. */
    renamedTo?: string[];
    refs: SymbolReference[];
  }[];
  arityChanged: {
    symbol: string;
    specifier?: string;
    from: number | null;
    to: number | null;
    fromMax?: number | null;
    toMax?: number | null;
    refs: SymbolReference[];
    /**
     * Calls this change breaks: each passed an argument count the old version
     * accepted and the new one does not. Present only when every use of the
     * symbol was followed; see `judgeCalls`.
     */
    callsBroken?: { file: string; line: number; args: number }[];
    /** Uses that could not be counted: a spread, or the function passed as a value. */
    unmeasured?: { file: string; line: number }[];
  }[];
  /**
   * Runtime exports that exist at the target version and did not at the source
   * — the verified candidates for whatever replaced `symbolsRemoved`.
   *
   * This is the other half of the answer and it used to be computed and thrown
   * away. Knowing `renderToString` disappeared does not tell an agent to reach
   * for `renderToPipeableStream`; the agent that rewrites the call sites runs
   * with no network tool and no MCP access, so without this list its only source
   * for a replacement is the training data whose staleness is the entire reason
   * lurq exists. Extracted from the target's own shipped JS, so it is a fact
   * about the package rather than a recollection.
   *
   * Same-kind-as-something-removed first, then alphabetical, then capped: a
   * package can add hundreds of exports and this rides inside a brief a model
   * has to read.
   */
  newExports: { symbol: string; kind: SymbolKind; arity: number | null }[];
  /**
   * Compiler errors the upgrade introduces in files that import the package:
   * renamed options, narrowed parameters, widened return types. None of those
   * change the runtime surface, so nothing above can see them. See typecheck.ts.
   */
  typeErrors?: TypeDiagnostic[];
  /**
   * Subpath entry points the code imports that the new version no longer offers
   * at all. The import throws before any symbol is read. BLOCKING.
   */
  entriesRemoved?: { specifier: string; refs: SymbolReference[] }[];
  /** `require()` of a package that stopped being CommonJS. See requirements.ts. */
  moduleFormat?: RequireBreak;
  /** Node or peer versions the new release needs and this project lacks. See requirements.ts. */
  requirements?: Requirement[];
}

/** How many candidate replacements travel with one finding. Enough to contain
 *  the real replacement, small enough to stay legible inside the brief. */
const NEW_EXPORT_CAP = 40;

export interface UpgradeReport {
  safe: boolean;
  breaking: BreakingFinding[];
  /** Packages checked with nothing referenced affected. */
  ok: string[];
  /** Could not be established — NEVER counted as safe. */
  unverified: { package: string; reason: string }[];
  /**
   * Which packages were type-checked, and why the rest were not. Informational:
   * a JavaScript project, or a package typed through `@types/*`, cannot be type
   * checked, and that is no reason to call the upgrade unsafe. Absent when the
   * type check was switched off.
   */
  types?: TypeCoverage[];
}

export type TypeCoverage =
  | { package: string; checked: true; files: number }
  | { package: string; checked: false; reason: string };

export interface CheckOptions {
  typeCheck?: TypeCheckFn;
  /** The project's declared Node support, for the module-format judgement. */
  runtime?: RepoRuntime;
}

export interface UpgradeCheck {
  finding?: BreakingFinding;
  unverified?: string;
  /** Absent when no type check was asked for. */
  types?: TypeCheck;
}

/**
 * Split a package's references by the entry point they were imported from.
 * The key is the subpath (`pg-core`), or `''` for the package root.
 *
 * This grouping is the whole of the subpath fix. `drizzle-orm/pg-core` is a
 * different module with a different export surface than `drizzle-orm`, and the
 * check used to keep only root-specifier references, so a repo importing
 * `pgTable` from the subpath had those symbols silently discarded, and a package
 * whose every use was a subpath import was compared against an empty reference
 * set and reported OK. In this repo that was 40% of all references.
 */
function groupByEntry(
  refs: PackageReferences,
  pkg: string,
): Map<string, Map<string, SymbolReference[]>> {
  const byEntry = new Map<string, Map<string, SymbolReference[]>>();
  for (const [sym, uses] of refs.symbols) {
    for (const use of uses) {
      if (use.specifier !== pkg && !use.specifier.startsWith(`${pkg}/`)) continue;
      const sub = use.specifier === pkg ? '' : use.specifier.slice(pkg.length + 1);
      let symbols = byEntry.get(sub);
      if (!symbols) byEntry.set(sub, (symbols = new Map()));
      const list = symbols.get(sym);
      if (list) list.push(use);
      else symbols.set(sym, [use]);
    }
  }
  return byEntry;
}

/** Runtime exports of `surface` whose value is a plain object. */
function objectPaths(surface: ExtractedSurface): Set<string> {
  return new Set(
    runtimeSymbols(surface)
      .filter((s) => s.kind === 'object')
      .map((s) => s.path),
  );
}

/**
 * Does a `named-member` read assert something about the module's export surface?
 *
 * Exported and kept tiny because it is the money path: a wrong `true` here is a
 * BLOCKING result on correct code, which is the §12 M3 kill condition.
 *
 * True only for a namespace-shaped parent: an exported object that groups the
 * same names the module also exports at the top level. zod is the case that
 * drove this, and `z.string` and the top-level `string` are the same function.
 * Requiring `object` in BOTH versions keeps `vi.fn()` and `expect.any()` out,
 * since those parents are not object exports at all. The remaining guard is
 * implicit at the call site: only `diff.removed` is consulted, so a property
 * that was never a top-level export of the from-version cannot be reached.
 */
export function isNamespaceMemberClaim(
  ref: SymbolReference,
  fromObjects: Set<string>,
  toObjects: Set<string>,
): boolean {
  if (ref.via !== 'named-member' || ref.parent === undefined) return false;
  return fromObjects.has(ref.parent) && toObjects.has(ref.parent);
}

/** Does a call with `args` arguments fit? A null or absent `max` is no upper bound. */
function accepts(args: number, required: number | null, max: number | null | undefined): boolean {
  return (
    (required === null || args >= required) && (max === null || max === undefined || args <= max)
  );
}

/**
 * Judge an arity change at the calls that reach it.
 *
 * A changed parameter count on its own is a guess about your code. What decides
 * it is the calls: `parse(str)` against a version that now requires two
 * arguments is broken, `parse(str, opts)` is not. A call counts as broken only
 * when the old version accepted its argument count and the new one does not, so
 * a call that was already wrong is not blamed on the upgrade.
 *
 * Null when some value reference was never followed. Then there is nothing to
 * judge with, and the caller reports the change as it did before call sites
 * were counted rather than treating "did not look" as "fine".
 */
export function judgeCalls(
  change: ArityChange,
  refs: SymbolReference[],
): {
  broken: { file: string; line: number; args: number }[];
  unmeasured: { file: string; line: number }[];
} | null {
  const valueRefs = refs.filter((r) => r.via !== 'type-only');
  if (!valueRefs.length || valueRefs.some((r) => r.calls === undefined)) return null;
  const broken: { file: string; line: number; args: number }[] = [];
  const unmeasured: { file: string; line: number }[] = [];
  for (const r of valueRefs) {
    for (const c of r.calls!) {
      if (c.args === null) unmeasured.push({ file: r.file, line: c.line });
      else if (
        accepts(c.args, change.from, change.fromMax) &&
        !accepts(c.args, change.to, change.toMax)
      ) {
        broken.push({ file: r.file, line: c.line, args: c.args });
      }
    }
  }
  return { broken, unmeasured };
}

interface EntryComparison {
  symbolsRemoved: BreakingFinding['symbolsRemoved'];
  arityChanged: BreakingFinding['arityChanged'];
  candidates: BreakingFinding['newExports'];
  lostKinds: Set<SymbolKind>;
}

/** Compare one entry point's from/to surfaces against the symbols read from it. */
function compareEntry(
  from: ExtractedSurface | undefined,
  to: ExtractedSurface | undefined,
  symbols: Map<string, SymbolReference[]>,
  specifier: string,
  isRoot: boolean,
): EntryComparison | { unverified: string } {
  if (!from || !to) return { unverified: 'entry point not extracted' };
  if (from.undeclaredReason || to.undeclaredReason) {
    return { unverified: `no readable surface (${from.undeclaredReason ?? to.undeclaredReason})` };
  }

  const diff = diffSurfaces(from, to);
  if (diff.inconclusive) return { unverified: diff.inconclusive };

  // Only symbols claimed against the MODULE'S export surface can be "removed".
  // `chalk.bold` is a property of the default export's value — valid code that
  // tier A cannot see. Blocking a PR on that is the false positive that gets a
  // CI gate switched off inside two weeks (§12 M3 kill condition).
  const toSurface = new Set(runtimeSymbols(to).map((s) => s.path));
  const bareValue = toSurface.size <= 1 && toSurface.has('default');

  // ...and `z.string` can be one too, when the parent is namespace-shaped. See
  // isNamespaceMemberClaim for which parents qualify and why.
  const objectExports = objectPaths(from);
  const toObjects = objectPaths(to);
  const throughNamespaceObject = (r: SymbolReference): boolean =>
    isNamespaceMemberClaim(r, objectExports, toObjects);

  const referenced = new Set(
    [...symbols.entries()]
      .filter(
        ([sym, uses]) =>
          sym !== 'default' &&
          uses.some(
            (r) =>
              (SURFACE_CLAIM_KINDS.includes(r.via) && !(bareValue && r.via === 'namespace')) ||
              throughNamespaceObject(r),
          ),
      )
      .map(([sym]) => sym),
  );

  // `specifier` rides along only for subpaths, so root findings serialize
  // exactly as they did before this change.
  const tag = isRoot ? {} : { specifier };
  const renames = new Map(diff.renamed.map((r) => [r.path, r.to]));
  const symbolsRemoved = diff.removed
    .filter((s) => referenced.has(s.path) && !toSurface.has(s.path))
    .map((s) => {
      const renamedTo = renames.get(s.path);
      return {
        symbol: s.path,
        ...tag,
        ...(renamedTo ? { renamedTo } : {}),
        refs: symbols.get(s.path) ?? [],
      };
    });
  // `export * from 'core'` may still provide every one of those names. Tier A
  // cannot see through another package, so the honest answer is "could not
  // tell", never BLOCKING on code that may well load.
  const stars = starReExports(to);
  if (symbolsRemoved.length && stars.length) {
    return {
      unverified: `re-exports everything from ${stars.join(', ')}, which may still export ${symbolsRemoved.map((s) => s.symbol).join(', ')}`,
    };
  }
  return {
    symbolsRemoved,
    arityChanged: diff.arityChanged
      .filter((a) => referenced.has(a.path))
      .flatMap((a) => {
        const refs = symbols.get(a.path) ?? [];
        const judged = judgeCalls(a, refs);
        // Every use is a call that still fits. The change is real and does not
        // touch this codebase, and a warning about it is noise.
        if (judged && !judged.broken.length && !judged.unmeasured.length) return [];
        const { path, ...counts } = a;
        return [
          {
            symbol: path,
            ...tag,
            ...counts,
            refs,
            ...(judged ? { callsBroken: judged.broken, unmeasured: judged.unmeasured } : {}),
          },
        ];
      }),
    // The target's whole surface, not just what it added: a rename that shipped
    // the new name a major early leaves `diff.added` empty. `default` is never a
    // useful candidate, and the caller drops anything it just reported removed.
    candidates: runtimeSymbols(to)
      .filter((s) => s.path !== 'default')
      .map((s) => ({ symbol: s.path, kind: s.kind, arity: s.arity })),
    lostKinds: new Set(diff.removed.filter((s) => referenced.has(s.path)).map((s) => s.kind)),
  };
}

/**
 * Check one upgrade against what the codebase references.
 *
 * Only symbols the code actually uses are reported. A package can drop fifty
 * exports; if this codebase touches none of them, the upgrade is safe FOR THIS
 * CODEBASE, and saying otherwise trains people to ignore the check.
 *
 * Returns both channels rather than one of three, because a package can be
 * breaking on one entry point and unreadable on another: `drizzle-orm` can lose
 * a root symbol while `drizzle-orm/pg-core` fails to resolve. Collapsing that to
 * a single verdict has to discard one of the two facts, and discarding the
 * doubt is how the check ends up reporting safe when it did not look.
 */
export async function checkUpgradeOne(
  target: UpgradeTarget,
  refs: PackageReferences | undefined,
  opts: CheckOptions = {},
): Promise<UpgradeCheck> {
  if (!refs || refs.symbols.size === 0) return requirementsOnly(target, opts.runtime);

  const byEntry = groupByEntry(refs, target.package);
  if (byEntry.size === 0) return requirementsOnly(target, opts.runtime);

  // A range is not a version. The registry answers `^2.0.0` with a 404, which
  // would read as "not published" and send someone looking for a missing
  // release. Dist-tags (`latest`, `next`) are not ranges and resolve fine.
  const loose = [target.fromVersion, target.toVersion].filter(
    (v) => semver.validRange(v) && !semver.valid(v),
  );
  if (loose.length) {
    return {
      unverified: `expected exact versions, got ${target.fromVersion}..${target.toVersion}`,
    };
  }

  // Both versions stay unpacked until the comparison is done: extraction reads
  // each once, and the type check needs the two side by side. Settled rather
  // than `all`, so one failed download cannot leak the other's temp directory.
  const settled = await Promise.allSettled([
    unpackPackage(target.package, target.fromVersion),
    unpackPackage(target.package, target.toVersion),
  ]);
  try {
    const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failure) throw failure.reason;
    const [fromPkg, toPkg] = settled.map(
      (s) => (s as PromiseFulfilledResult<Unpacked | null>).value,
    );
    if (!fromPkg || !toPkg) {
      const missing = [fromPkg ? null : target.fromVersion, toPkg ? null : target.toVersion].filter(
        Boolean,
      );
      return {
        unverified: `not published on npm: ${missing.map((v) => `${target.package}@${v}`).join(', ')}`,
      };
    }
    return await compareVersions(target, refs, byEntry, fromPkg, toPkg, opts);
  } finally {
    await Promise.all(
      settled.map((s) => (s.status === 'fulfilled' && s.value ? s.value.cleanup() : undefined)),
    );
  }
}

/**
 * An upgrade nothing imports can still break the project: a CLI or build tool
 * that now needs a newer Node, a plugin whose peer range moved. Those facts are
 * in the registry manifests, so no tarball is downloaded to find them.
 *
 * Best effort by design. A registry failure here leaves the package OK, as it
 * was before this check existed, because nothing the code references is in
 * question; turning a network blip into "unverified" for every devDependency
 * in a plan would bury the findings that matter.
 */
async function requirementsOnly(
  target: UpgradeTarget,
  runtime: RepoRuntime | undefined,
): Promise<UpgradeCheck> {
  if (!runtime?.root) return {};
  try {
    const [from, to] = await Promise.all([
      fetchManifest(target.package, target.fromVersion),
      fetchManifest(target.package, target.toVersion),
    ]);
    const requirements = judgeRequirements(from, to, runtime);
    if (!requirements.length) return {};
    return {
      finding: {
        package: target.package,
        fromVersion: target.fromVersion,
        toVersion: target.toVersion,
        severity: 'warning',
        symbolsRemoved: [],
        arityChanged: [],
        newExports: [],
        requirements,
      },
    };
  } catch {
    return {};
  }
}

/** Every file that imports the package. Type-only imports included: they are
 *  exactly what a type check is for. */
function importingFiles(refs: PackageReferences, pkg: string): string[] {
  const files = new Set<string>();
  for (const uses of refs.symbols.values()) {
    for (const r of uses) {
      if (r.specifier === pkg || r.specifier.startsWith(`${pkg}/`)) files.add(r.file);
    }
  }
  return [...files];
}

/** A type check that throws is one that did not run, never a failed upgrade. */
function runTypeCheck(
  typeCheck: TypeCheckFn | undefined,
  pkg: string,
  fromDir: string,
  toDir: string,
  files: string[],
): TypeCheck | undefined {
  if (!typeCheck) return undefined;
  try {
    return typeCheck(pkg, fromDir, toDir, files);
  } catch (err) {
    return { checked: false, reason: `type check failed: ${String(err).slice(0, 160)}` };
  }
}

/** The old version resolved `sub`, and the new one withdrew it. */
function withdrawn(fromDir: string, toDir: string, sub: string): boolean {
  const fromManifest = readManifest(fromDir);
  if (!fromManifest || !resolveEntryCandidates(fromDir, fromManifest, sub).length) return false;
  return subpathWithdrawn(toDir, null, sub);
}

async function compareVersions(
  target: UpgradeTarget,
  refs: PackageReferences,
  byEntry: Map<string, Map<string, SymbolReference[]>>,
  fromPkg: Unpacked,
  toPkg: Unpacked,
  opts: CheckOptions,
): Promise<UpgradeCheck> {
  const subpaths = [...byEntry.keys()].filter(Boolean);
  const [from, to] = await Promise.all([
    extractUnpacked(target.package, fromPkg, subpaths),
    extractUnpacked(target.package, toPkg, subpaths),
  ]);
  const types = runTypeCheck(
    opts.typeCheck,
    target.package,
    fromPkg.pkgDir,
    toPkg.pkgDir,
    importingFiles(refs, target.package),
  );

  const symbolsRemoved: BreakingFinding['symbolsRemoved'] = [];
  const arityChanged: BreakingFinding['arityChanged'] = [];
  const candidates: BreakingFinding['newExports'] = [];
  const lostKinds = new Set<SymbolKind>();
  const blind: string[] = [];
  const entriesRemoved: NonNullable<BreakingFinding['entriesRemoved']> = [];

  for (const [sub, symbols] of byEntry) {
    const specifier = sub ? `${target.package}/${sub}` : target.package;
    // Before the surface comparison, which can only call an entry point that no
    // longer exists "unreadable".
    if (sub && withdrawn(fromPkg.pkgDir, toPkg.pkgDir, sub)) {
      const runtimeRefs = [...symbols.values()].flat().filter((r) => r.via !== 'type-only');
      if (runtimeRefs.length) {
        entriesRemoved.push({ specifier, refs: runtimeRefs });
        continue;
      }
    }
    // Loaded only for its side effects: nothing is claimed about its exports, so
    // there is no surface to compare, and reading one would call a stylesheet or
    // a bootstrap file "unreadable".
    if ([...symbols.values()].flat().every((r) => r.via === 'side-effect')) continue;
    const res = compareEntry(
      sub ? from.subpathSurfaces?.[sub] : from.surface,
      sub ? to.subpathSurfaces?.[sub] : to.surface,
      symbols,
      specifier,
      !sub,
    );
    if ('unverified' in res) {
      blind.push(byEntry.size === 1 ? res.unverified : `${specifier}: ${res.unverified}`);
      continue;
    }
    symbolsRemoved.push(...res.symbolsRemoved);
    arityChanged.push(...res.arityChanged);
    candidates.push(...res.candidates);
    for (const k of res.lostKinds) lostKinds.add(k);
  }

  // Every name the module exports, re-exports from other packages included. Null
  // when a wholesale re-export hides some of them: a name that looks missing may
  // arrive through it.
  const exportNames = (s: ExtractedSurface) =>
    s.undeclaredReason || starReExports(s).length
      ? null
      : new Set(s.symbols.filter((x) => x.kind !== 'type_only').map((x) => x.path));
  const fromTarget = requireTarget(fromPkg.pkgDir);
  const toTarget = requireTarget(toPkg.pkgDir);
  // The graph walk is only worth it when require() is about to be handed an ES module.
  const asyncModule =
    fromTarget?.format === 'cjs' && toTarget?.format === 'esm' && toTarget.file
      ? (await import('./extract')).usesTopLevelAwait(toPkg.pkgDir, toTarget.file)
      : false;
  const moduleFormat = judgeRequires(
    fromTarget?.format ?? null,
    toTarget?.format ?? null,
    [...(byEntry.get('')?.values() ?? [])].flat(),
    {
      fromExports: exportNames(from.surface),
      toExports: exportNames(to.surface),
      runtime: opts.runtime ?? {},
      asyncModule,
    },
  );

  const requirements = judgeRequirements(
    readManifest(fromPkg.pkgDir),
    readManifest(toPkg.pkgDir),
    opts.runtime ?? {},
  );

  const unverified = blind.length ? blind.join('; ') : undefined;
  const typeErrors = types?.checked ? types.introduced : [];
  const extras = { ...(unverified ? { unverified } : {}), ...(types ? { types } : {}) };
  if (
    !symbolsRemoved.length &&
    !arityChanged.length &&
    !typeErrors.length &&
    !entriesRemoved.length &&
    !moduleFormat &&
    !requirements.length
  ) {
    return extras;
  }

  // Candidates are what the TARGET exports, not what it added.
  //
  // This read `diff.added` — symbols present at the target and absent at the
  // source. That is right for "the library grew a new API" and wrong for the
  // commonest rename there is: ship the new name, let both live, remove the old
  // one a major later. cookie did exactly that. Going 1.1.1 → 2.0.1 removes
  // `parse` and `serialize`, and `parseCookie` and `stringifyCookie` — the
  // things you are supposed to call instead — had been exported since 1.x. So
  // `diff.added` was empty, and a caller holding a blocking finding got
  // `"newExports": []`: told what broke, told nothing about what to write.
  //
  // The model does the mapping, and does it well, given the candidates. It
  // cannot do it from an empty array. So this hands over the target's surface
  // and leaves the choice where it belongs; there is deliberately no matcher
  // here, because `parse(str, options?)` → `parseCookie(str, options?)` is not
  // a problem that needs one.
  //
  // `renamedTo` is not that matcher. It is set only when the package itself
  // exported both names from one declaration, which is a fact, not a judgement;
  // cookie is exactly that case, and for it the candidate list is no longer needed.
  //
  // Ranking survives as a retrieval filter rather than an answer. Surfaces run
  // to 129 exports for react-router and 240 for zod, so the cap is real and
  // what it keeps matters: symbols whose kind matches something this codebase
  // just lost come first, so a removed function is not pushed out by constants.
  //
  // Collected per entry point, so a package used through several of them offers
  // candidates from each. Deduped on the symbol name: `lostKinds` and the cap
  // both count distinct names, and two entry points can re-export one.
  const removedNames = new Set(symbolsRemoved.map((s) => s.symbol));
  const seen = new Set<string>();
  const newExports = candidates
    .filter((c) => !removedNames.has(c.symbol) && !seen.has(c.symbol) && seen.add(c.symbol))
    .sort(
      (a, b) =>
        Number(lostKinds.has(b.kind)) - Number(lostKinds.has(a.kind)) ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, NEW_EXPORT_CAP);

  return {
    finding: {
      package: target.package,
      fromVersion: target.fromVersion,
      toVersion: target.toVersion,
      severity:
        symbolsRemoved.length || entriesRemoved.length || moduleFormat?.broken.length
          ? 'blocking'
          : 'warning',
      symbolsRemoved,
      arityChanged,
      newExports,
      ...(typeErrors.length ? { typeErrors } : {}),
      ...(entriesRemoved.length ? { entriesRemoved } : {}),
      ...(moduleFormat ? { moduleFormat } : {}),
      ...(requirements.length ? { requirements } : {}),
    },
    ...extras,
  };
}

export async function checkUpgrade(
  targets: UpgradeTarget[],
  references: PackageReferences[],
  opts: { typeCheck?: TypeCheckFn; rootDir?: string } = {},
): Promise<UpgradeReport> {
  const byPkg = new Map(references.map((r) => [r.package, r]));
  const breaking: BreakingFinding[] = [];
  const ok: string[] = [];
  const unverified: UpgradeReport['unverified'] = [];
  const types: TypeCoverage[] = [];
  const runtime = opts.rootDir ? readRepoRuntime(opts.rootDir) : {};

  for (const t of targets) {
    try {
      const res = await checkUpgradeOne(t, byPkg.get(t.package), {
        typeCheck: opts.typeCheck,
        runtime,
      });
      if (res.types) {
        types.push(
          res.types.checked
            ? { package: t.package, checked: true, files: res.types.files }
            : { package: t.package, checked: false, reason: res.types.reason },
        );
      }
      if (res.finding) breaking.push(res.finding);
      if (res.unverified) unverified.push({ package: t.package, reason: res.unverified });
      if (!res.finding && !res.unverified) ok.push(t.package);
    } catch (err) {
      unverified.push({ package: t.package, reason: String(err).slice(0, 160) });
    }
  }

  return {
    // `safe` requires that nothing broke AND nothing was left unchecked.
    safe: breaking.length === 0 && unverified.length === 0,
    breaking,
    ok,
    unverified,
    ...(opts.typeCheck ? { types } : {}),
  };
}

/** Candidates listed in the text report. The full set stays in the JSON; this
 *  keeps the report to the one screen §9.0 asks for. */
const REPORT_CANDIDATE_CAP = 8;
/** Locations listed per symbol in the text report, for the same reason. */
const REPORT_LOCATION_CAP = 6;

function capped(items: string[], cap = REPORT_LOCATION_CAP): string {
  const shown = items.slice(0, cap).join(', ');
  return items.length > cap ? `${shown} (+${items.length - cap} more)` : shown;
}

/** The import, then every use it leads to. In ESM a missing named export fails
 *  the whole module at load, so the import line is itself a break site. */
function locations(refs: SymbolReference[]): string {
  const all = refs.flatMap((r) => [
    `${r.file}:${r.line}`,
    ...(r.calls ?? []).map((c) => `${r.file}:${c.line}`),
  ]);
  return capped([...new Set(all)]) || '(no location)';
}

/** `1`, `1–2`, or `1+` for unbounded. */
function params(required: number | null, max?: number | null): string {
  if (max === undefined || max === required) return `${required}`;
  return max === null ? `${required}+` : `${required}–${max}`;
}

/** The §9.0 report: fits on one screen, names files and lines. */
export function formatUpgradeReport(report: UpgradeReport, title = 'upgrade check'): string {
  const out: string[] = [`lurq, ${title}`, ''];

  for (const b of report.breaking.sort((a, z) => (a.severity === 'blocking' ? -1 : 1))) {
    const label = b.severity === 'blocking' ? 'BLOCKING' : 'WARNING ';
    out.push(`${label}  ${b.package}  ${b.fromVersion} → ${b.toVersion}`);
    if (b.symbolsRemoved.length) {
      out.push(`  Removes ${b.symbolsRemoved.length} symbol(s) your code references:`);
      for (const s of b.symbolsRemoved) {
        const where = locations(s.refs);
        const rename = s.renamedTo ? ` → ${s.renamedTo.join(' | ')}` : '';
        out.push(`    · ${s.specifier ?? b.package}.${s.symbol}${rename}    ${where}`);
      }
      if (b.symbolsRemoved.some((s) => s.renamedTo)) {
        out.push(`  → is a proven rename: both names were the same function at ${b.fromVersion}.`);
      }
    }
    for (const e of b.entriesRemoved ?? []) {
      out.push(`  Removes entry point ${e.specifier}, which your code imports:`);
      out.push(`    · ${locations(e.refs)}`);
    }
    if (b.moduleFormat) {
      const m = b.moduleFormat;
      out.push(
        m.to === 'esm'
          ? `  require('${b.package}') now loads an ES module (was CommonJS)`
          : `  require('${b.package}') no longer resolves: its exports map offers require() nothing`,
      );
      for (const x of m.broken.slice(0, REPORT_LOCATION_CAP))
        out.push(`    · ${x.file}:${x.line}  ${x.why}`);
      if (m.broken.length > REPORT_LOCATION_CAP)
        out.push(`    · (+${m.broken.length - REPORT_LOCATION_CAP} more)`);
      if (m.olderNode.length) {
        out.push(
          `    · throws ERR_REQUIRE_ESM on Node before 20.19 / 22.12: ${capped(m.olderNode.map((s) => `${s.file}:${s.line}`))}`,
        );
      }
    }
    for (const r of b.requirements ?? []) {
      out.push(`  Requires ${r.name} ${r.needs}; this project has ${r.has}`);
    }
    for (const a of b.arityChanged) {
      out.push(
        `  Arity change: ${a.specifier ?? b.package}.${a.symbol} ${params(a.from, a.fromMax)} → ${params(a.to, a.toMax)} params`,
      );
      if (!a.callsBroken) {
        out.push(`    · ${locations(a.refs)}`);
        continue;
      }
      for (const c of a.callsBroken.slice(0, REPORT_LOCATION_CAP)) {
        out.push(`    · ${c.file}:${c.line} passes ${c.args}`);
      }
      if (a.callsBroken.length > REPORT_LOCATION_CAP) {
        out.push(`    · (+${a.callsBroken.length - REPORT_LOCATION_CAP} more calls)`);
      }
      if (a.unmeasured?.length) {
        out.push(
          `    · not countable (spread, or passed as a value): ${capped(a.unmeasured.map((u) => `${u.file}:${u.line}`))}`,
        );
      }
    }
    if (b.typeErrors?.length) {
      out.push(`  Type errors this upgrade introduces (${b.typeErrors.length}):`);
      for (const e of b.typeErrors.slice(0, REPORT_LOCATION_CAP)) {
        const message = e.message.length > 140 ? `${e.message.slice(0, 139)}…` : e.message;
        out.push(`    · ${e.file}:${e.line}  TS${e.code}  ${message}`);
      }
      if (b.typeErrors.length > REPORT_LOCATION_CAP) {
        out.push(`    · (+${b.typeErrors.length - REPORT_LOCATION_CAP} more)`);
      }
    }
    // The reader's next question is always "replaced by what", so answer it here
    // rather than making them open the JSON. Named as candidates, not as a
    // mapping: these are the exports the target version gained, and which one
    // replaces which is a judgement this diff cannot make.
    if (b.symbolsRemoved.some((s) => !s.renamedTo) && b.newExports.length) {
      const shown = b.newExports.slice(0, REPORT_CANDIDATE_CAP);
      const more = b.newExports.length - shown.length;
      out.push(
        `  New at ${b.toVersion}, candidate replacements: ${shown.map((n) => n.symbol).join(', ')}${more > 0 ? ` (+${more} more)` : ''}`,
      );
    }
    out.push('');
  }

  if (report.unverified.length) {
    out.push(`UNVERIFIED  ${report.unverified.length} package(s), not checked, NOT declared safe:`);
    for (const u of report.unverified) out.push(`    · ${u.package}: ${u.reason}`);
    out.push('');
  }

  const typed = report.types ?? [];
  const unchecked = typed.filter((t): t is Extract<TypeCoverage, { checked: false }> => !t.checked);
  if (typed.length > unchecked.length) {
    out.push(
      `TYPES     checked ${typed.length - unchecked.length} package(s) in the files that import them`,
    );
  }
  if (unchecked.length) {
    out.push(`TYPES     not checked for ${unchecked.length} package(s):`);
    // Grouped by reason: a JavaScript project gives every package the same one.
    const byReason = new Map<string, string[]>();
    for (const t of unchecked)
      byReason.set(t.reason, [...(byReason.get(t.reason) ?? []), t.package]);
    for (const [reason, names] of byReason) out.push(`    · ${names.join(', ')}: ${reason}`);
  }
  if (typed.length) out.push('');

  if (report.ok.length) {
    out.push(`OK        ${report.ok.length} package(s), no referenced symbols removed`);
  }
  if (!report.breaking.length && !report.unverified.length) {
    out.push('', 'No referenced symbols are removed by these upgrades.');
  }
  return out.join('\n');
}
