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
import { fetchAndExtract } from './fetch';
import { diffSurfaces } from './diff';
import { SURFACE_CLAIM_KINDS } from './references';
import type { PackageReferences, SymbolReference } from './references';
import { runtimeSymbols, type ExtractedSurface, type SymbolKind } from './types';

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
  symbolsRemoved: { symbol: string; specifier?: string; refs: SymbolReference[] }[];
  arityChanged: {
    symbol: string;
    specifier?: string;
    from: number | null;
    to: number | null;
    refs: SymbolReference[];
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
export function objectPaths(surface: ExtractedSurface): Set<string> {
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

  /**
   * Is `z.string` a claim about the module's own export surface?
   *
   * Only when the parent is a namespace-shaped export: an object that groups
   * the same names the module also exports at the top level. zod is the case
   * that matters here, and `z.string` and the top-level `string` really are the
   * same function, so a removal of one is a removal of the other.
   *
   * Two guards, both aimed at the false BLOCKING result rather than the miss.
   * The parent must be an `object` in both versions, so `foo.bar()` on a
   * function or class export never routes here. And the member has to already
   * be a top-level export of the FROM version, which falls out of only ever
   * consulting `diff.removed`: a property that was never a module export cannot
   * appear there, so an unrelated same-named export can only be reached if the
   * package genuinely exported that name and then dropped it.
   */
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
  return {
    symbolsRemoved: diff.removed
      .filter((s) => referenced.has(s.path) && !toSurface.has(s.path))
      .map((s) => ({ symbol: s.path, ...tag, refs: symbols.get(s.path) ?? [] })),
    arityChanged: diff.arityChanged
      .filter((a) => referenced.has(a.path))
      .map((a) => ({
        symbol: a.path,
        ...tag,
        from: a.from,
        to: a.to,
        refs: symbols.get(a.path) ?? [],
      })),
    candidates: diff.added.map((s) => ({ symbol: s.path, kind: s.kind, arity: s.arity })),
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
): Promise<{ finding?: BreakingFinding; unverified?: string }> {
  if (!refs || refs.symbols.size === 0) return {};

  const byEntry = groupByEntry(refs, target.package);
  if (byEntry.size === 0) return {};
  const subpaths = [...byEntry.keys()].filter(Boolean);

  const [from, to] = await Promise.all([
    fetchAndExtract(target.package, target.fromVersion, { subpaths }),
    fetchAndExtract(target.package, target.toVersion, { subpaths }),
  ]);
  if (!from || !to) return { unverified: 'could not fetch one or both versions' };

  const symbolsRemoved: BreakingFinding['symbolsRemoved'] = [];
  const arityChanged: BreakingFinding['arityChanged'] = [];
  const candidates: BreakingFinding['newExports'] = [];
  const lostKinds = new Set<SymbolKind>();
  const blind: string[] = [];

  for (const [sub, symbols] of byEntry) {
    const specifier = sub ? `${target.package}/${sub}` : target.package;
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

  const unverified = blind.length ? blind.join('; ') : undefined;
  if (!symbolsRemoved.length && !arityChanged.length) {
    return unverified ? { unverified } : {};
  }

  // Rank by kind against what this codebase lost, so a removed function is not
  // pushed off the cap by newly added constants.
  const seen = new Set<string>();
  const newExports = candidates
    .filter((c) => !seen.has(c.symbol) && seen.add(c.symbol))
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
      severity: symbolsRemoved.length ? 'blocking' : 'warning',
      symbolsRemoved,
      arityChanged,
      newExports,
    },
    ...(unverified ? { unverified } : {}),
  };
}

export async function checkUpgrade(
  targets: UpgradeTarget[],
  references: PackageReferences[],
): Promise<UpgradeReport> {
  const byPkg = new Map(references.map((r) => [r.package, r]));
  const breaking: BreakingFinding[] = [];
  const ok: string[] = [];
  const unverified: UpgradeReport['unverified'] = [];

  for (const t of targets) {
    try {
      const res = await checkUpgradeOne(t, byPkg.get(t.package));
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
  };
}

/** Candidates listed in the text report. The full set stays in the JSON; this
 *  keeps the report to the one screen §9.0 asks for. */
const REPORT_CANDIDATE_CAP = 8;

/** The §9.0 report: fits on one screen, names files and lines. */
export function formatUpgradeReport(report: UpgradeReport, title = 'upgrade check'): string {
  const out: string[] = [`lurq — ${title}`, ''];

  for (const b of report.breaking.sort((a, z) => (a.severity === 'blocking' ? -1 : 1))) {
    const label = b.severity === 'blocking' ? 'BLOCKING' : 'WARNING ';
    out.push(`${label}  ${b.package}  ${b.fromVersion} → ${b.toVersion}`);
    if (b.symbolsRemoved.length) {
      out.push(`  Removes ${b.symbolsRemoved.length} symbol(s) your code references:`);
      for (const s of b.symbolsRemoved) {
        const where = s.refs.map((r) => `${r.file}:${r.line}`).join(', ') || '(no location)';
        out.push(`    · ${s.specifier ?? b.package}.${s.symbol}    ${where}`);
      }
    }
    for (const a of b.arityChanged) {
      const where = a.refs.map((r) => `${r.file}:${r.line}`).join(', ') || '(no location)';
      out.push(`  Arity change: ${a.specifier ?? b.package}.${a.symbol} ${a.from} → ${a.to} params`);
      out.push(`    · ${where}`);
    }
    // The reader's next question is always "replaced by what", so answer it here
    // rather than making them open the JSON. Named as candidates, not as a
    // mapping: these are the exports the target version gained, and which one
    // replaces which is a judgement this diff cannot make.
    if (b.symbolsRemoved.length && b.newExports.length) {
      const shown = b.newExports.slice(0, REPORT_CANDIDATE_CAP);
      const more = b.newExports.length - shown.length;
      out.push(
        `  New at ${b.toVersion}, candidate replacements: ${shown.map((n) => n.symbol).join(', ')}${more > 0 ? ` (+${more} more)` : ''}`,
      );
    }
    out.push('');
  }

  if (report.unverified.length) {
    out.push(`UNVERIFIED  ${report.unverified.length} package(s) — not checked, NOT declared safe:`);
    for (const u of report.unverified) out.push(`    · ${u.package}: ${u.reason}`);
    out.push('');
  }

  if (report.ok.length) {
    out.push(`OK        ${report.ok.length} package(s) — no referenced symbols removed`);
  }
  if (!report.breaking.length && !report.unverified.length) {
    out.push('', 'No referenced symbols are removed by these upgrades.');
  }
  return out.join('\n');
}
