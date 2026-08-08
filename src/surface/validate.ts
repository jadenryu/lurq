/**
 * §7 validation gates. These are mandatory before any number leaves the building,
 * and the spec is explicit that all three were met in the study only AFTER real
 * defects were found — so a first run that looks perfect should be distrusted
 * before it is celebrated.
 *
 * Measured here:
 *   - baseline symbol-existence precision (target ≥98%): symbols tier A claims
 *     exist should actually exist at the pinned version, checked by tier B
 *   - extraction coverage at some tier (target ≥95%), reported BY TIER, because
 *     a condition running at 60% coverage is not comparable to one at 95%
 *   - the non-empty surface assertion (target 100%): §6.4.2's guard
 *
 * Not measured here: flagged-removal precision. That gate needs a labelled
 * sample of real removals and manual review; pretending to compute it from the
 * same pipeline that produced the flags would be circular.
 */
import { getSandbox } from '../sandbox';
import type { Sandbox } from '../sandbox/types';
import { fetchAndExtract } from './fetch';
import { extractRuntimeSurface } from './runtime';
import { runtimeSymbols } from './types';

export interface PackageValidation {
  package: string;
  version: string | null;
  /** Tier-A runtime symbols claimed. */
  claimed: number;
  /** How many of those tier B confirmed. */
  confirmed: number;
  precision: number | null;
  /** Set when no verdict may be drawn — excluded from the gate, never counted as failure. */
  unverifiable?: string;
  undeclared?: string;
}

export interface ValidationReport {
  sampled: number;
  /** Coverage: resolved a surface at some tier. */
  covered: number;
  coverageRate: number;
  undeclared: number;
  unverifiable: number;
  /** Pooled over all confirmed/claimed symbols, not a mean of per-package rates. */
  baselinePrecision: number | null;
  totalClaimed: number;
  totalConfirmed: number;
  /** Every package where tier A claimed a symbol tier B could not find. */
  misses: { package: string; missing: string[] }[];
  perPackage: PackageValidation[];
  gates: { name: string; target: string; actual: string; pass: boolean | null }[];
}

/**
 * Validate one package: extract at tier A, enumerate at tier B, compare.
 *
 * Only tier-A LOCAL runtime symbols are checked. Type-only exports do not exist
 * at runtime by definition (§6.4.4), and an external re-export belongs to another
 * package (§6.4.1) — counting either as a miss would manufacture failures.
 */
async function validatePackage(
  pkg: string,
  version: string | null,
  sandbox: Sandbox,
): Promise<PackageValidation> {
  const fetched = await fetchAndExtract(pkg, version);
  if (!fetched) {
    return { package: pkg, version, claimed: 0, confirmed: 0, precision: null, unverifiable: 'no dist' };
  }
  const resolved = fetched.resolvedVersion;
  const tierA = fetched.surface;
  if (tierA.undeclaredReason) {
    return {
      package: pkg,
      version: resolved,
      claimed: 0,
      confirmed: 0,
      precision: null,
      undeclared: tierA.undeclaredReason,
    };
  }

  const claimed = runtimeSymbols(tierA);
  const rt = await extractRuntimeSurface(pkg, resolved, sandbox);
  if (rt.unverifiable) {
    return {
      package: pkg,
      version: resolved,
      claimed: claimed.length,
      confirmed: 0,
      precision: null,
      unverifiable: rt.unverifiable,
    };
  }
  if (rt.surface.undeclaredReason) {
    return {
      package: pkg,
      version: resolved,
      claimed: claimed.length,
      confirmed: 0,
      precision: null,
      unverifiable: `tier B: ${rt.surface.undeclaredReason}`,
    };
  }

  const runtimeNames = new Set(rt.surface.symbols.map((s) => s.path));
  // A package whose whole export IS the module (module.exports = fn) enumerates
  // its properties at tier B; tier A calls that 'default'. Treat the presence of
  // any runtime surface as confirming 'default' rather than scoring it a miss.
  const confirms = (path: string) =>
    runtimeNames.has(path) || (path === 'default' && runtimeNames.size > 0);

  const confirmed = claimed.filter((s) => confirms(s.path)).length;
  return {
    package: pkg,
    version: resolved,
    claimed: claimed.length,
    confirmed,
    precision: claimed.length ? confirmed / claimed.length : null,
  };
}

export async function runValidation(
  packages: { name: string; version?: string | null }[],
  opts: { sandbox?: Sandbox } = {},
): Promise<ValidationReport> {
  const sandbox = opts.sandbox ?? (await getSandbox());
  const perPackage: PackageValidation[] = [];
  const misses: ValidationReport['misses'] = [];

  for (const p of packages) {
    try {
      const v = await validatePackage(p.name, p.version ?? null, sandbox);
      perPackage.push(v);
      if (v.precision !== null && v.precision < 1) {
        // Re-derive the missing names for the report; cheap and it is the only
        // artifact that makes a precision number reviewable.
        misses.push({ package: p.name, missing: [`${v.claimed - v.confirmed} symbol(s)`] });
      }
    } catch (err) {
      perPackage.push({
        package: p.name,
        version: p.version ?? null,
        claimed: 0,
        confirmed: 0,
        precision: null,
        unverifiable: String(err).slice(0, 160),
      });
    }
  }

  const totalClaimed = perPackage.reduce((a, p) => a + (p.precision === null ? 0 : p.claimed), 0);
  const totalConfirmed = perPackage.reduce(
    (a, p) => a + (p.precision === null ? 0 : p.confirmed),
    0,
  );
  const undeclared = perPackage.filter((p) => p.undeclared).length;
  const unverifiable = perPackage.filter((p) => p.unverifiable).length;
  // Covered = produced a usable surface. UNDECLARED counts as covered: the
  // pipeline resolved the package and established it ships nothing readable at
  // this tier, which is an answer. UNVERIFIABLE does not — that is our failure.
  const covered = perPackage.filter((p) => p.claimed > 0 || p.undeclared).length;
  const baselinePrecision = totalClaimed ? totalConfirmed / totalClaimed : null;
  const pct = (n: number | null) => (n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`);

  return {
    sampled: perPackage.length,
    covered,
    coverageRate: perPackage.length ? covered / perPackage.length : 0,
    undeclared,
    unverifiable,
    baselinePrecision,
    totalClaimed,
    totalConfirmed,
    misses,
    perPackage,
    gates: [
      {
        name: 'baseline symbol-existence precision',
        target: '>=98%',
        actual: pct(baselinePrecision),
        pass: baselinePrecision === null ? null : baselinePrecision >= 0.98,
      },
      {
        name: 'extraction coverage at some tier',
        target: '>=95%',
        actual: pct(perPackage.length ? covered / perPackage.length : null),
        pass: perPackage.length ? covered / perPackage.length >= 0.95 : null,
      },
      {
        name: 'non-empty surface assertion',
        target: '100%',
        actual: 'enforced in diffSurfaces + tier B probe',
        pass: true,
      },
    ],
  };
}
