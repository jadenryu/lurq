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
import { SURFACE_CLAIM_KINDS, isRootSpecifier } from './references';
import type { PackageReferences, SymbolReference } from './references';
import { runtimeSymbols, type SymbolKind } from './types';

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
  /** Referenced symbols removed at the target version. */
  symbolsRemoved: { symbol: string; refs: SymbolReference[] }[];
  arityChanged: { symbol: string; from: number | null; to: number | null; refs: SymbolReference[] }[];
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
 * Check one upgrade against what the codebase references.
 *
 * Only symbols the code actually uses are reported. A package can drop fifty
 * exports; if this codebase touches none of them, the upgrade is safe FOR THIS
 * CODEBASE, and saying otherwise trains people to ignore the check.
 */
export async function checkUpgradeOne(
  target: UpgradeTarget,
  refs: PackageReferences | undefined,
): Promise<BreakingFinding | { ok: true } | { unverified: string }> {
  if (!refs || refs.symbols.size === 0) return { ok: true };

  const [from, to] = await Promise.all([
    fetchAndExtract(target.package, target.fromVersion),
    fetchAndExtract(target.package, target.toVersion),
  ]);
  if (!from || !to) return { unverified: 'could not fetch one or both versions' };
  if (from.surface.undeclaredReason || to.surface.undeclaredReason) {
    return {
      unverified: `no readable surface (${from.surface.undeclaredReason ?? to.surface.undeclaredReason})`,
    };
  }

  const diff = diffSurfaces(from.surface, to.surface);
  if (diff.inconclusive) return { unverified: diff.inconclusive };

  // Only symbols claimed against the MODULE'S export surface can be "removed".
  // `chalk.bold` is a property of the default export's value — valid code that
  // tier A cannot see. Blocking a PR on that is the false positive that gets a
  // CI gate switched off inside two weeks (§12 M3 kill condition).
  const toSurface = new Set(runtimeSymbols(to.surface).map((s) => s.path));
  const bareValue = toSurface.size <= 1 && toSurface.has('default');
  const referenced = new Set(
    [...refs.symbols.entries()]
      .filter(
        ([sym, uses]) =>
          sym !== 'default' &&
          uses.some(
            (r) =>
              SURFACE_CLAIM_KINDS.includes(r.via) &&
              isRootSpecifier(r, target.package) &&
              !(bareValue && r.via === 'namespace'),
          ),
      )
      .map(([sym]) => sym),
  );
  const stillExports = toSurface;

  const symbolsRemoved = diff.removed
    .filter((s) => referenced.has(s.path) && !stillExports.has(s.path))
    .map((s) => ({ symbol: s.path, refs: refs.symbols.get(s.path) ?? [] }));

  const arityChanged = diff.arityChanged
    .filter((a) => referenced.has(a.path))
    .map((a) => ({ symbol: a.path, from: a.from, to: a.to, refs: refs.symbols.get(a.path) ?? [] }));

  if (!symbolsRemoved.length && !arityChanged.length) return { ok: true };

  // Rank by kind against what this codebase lost, so a removed function is not
  // pushed off the cap by newly added constants.
  const lostKinds = new Set(
    diff.removed.filter((s) => referenced.has(s.path)).map((s) => s.kind),
  );
  const newExports = diff.added
    .map((s) => ({ symbol: s.path, kind: s.kind, arity: s.arity }))
    .sort(
      (a, b) =>
        Number(lostKinds.has(b.kind)) - Number(lostKinds.has(a.kind)) ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, NEW_EXPORT_CAP);

  return {
    package: target.package,
    fromVersion: target.fromVersion,
    toVersion: target.toVersion,
    severity: symbolsRemoved.length ? 'blocking' : 'warning',
    symbolsRemoved,
    arityChanged,
    newExports,
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
      if ('ok' in res) ok.push(t.package);
      else if ('unverified' in res) unverified.push({ package: t.package, reason: res.unverified });
      else breaking.push(res);
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
        out.push(`    · ${b.package}.${s.symbol}    ${where}`);
      }
    }
    for (const a of b.arityChanged) {
      const where = a.refs.map((r) => `${r.file}:${r.line}`).join(', ') || '(no location)';
      out.push(`  Arity change: ${a.symbol} ${a.from} → ${a.to} params`);
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
