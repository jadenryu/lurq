/**
 * Supply-chain risk gate.
 *
 * Rolls the individual findings from `verify` into a single level an agent can
 * act on before installing:
 *   high   — do not install without human review
 *   medium — proceed with caution / prefer an alternative
 *   low    — no supply-chain red flags
 *
 * Install scripts alone are NOT escalated (esbuild, sharp, husky all use them);
 * they only matter on an otherwise low-trust package.
 */
import type { RiskLevel } from '../core/types';

export interface RiskInput {
  /** All collected riskFlags (used for the `single-maintainer` signal). */
  flags: string[];
  hasCriticalOrHighAdvisory: boolean;
  /** Name closely mimics a popular package. */
  typosquat: boolean;
  /** Runs preinstall/install/postinstall hooks. */
  installScripts: boolean;
  /** First published within the last 7 days. */
  brandNew: boolean;
  /** Fewer than ~1k weekly downloads (or unknown). */
  lowTrust: boolean;
  deprecatedOrArchived: boolean;
}

export function assessRisk(i: RiskInput): RiskLevel {
  // Classic malware fingerprint: brand-new + install hooks + ~no adoption.
  const malwarePattern = i.installScripts && i.brandNew && i.lowTrust;
  if (i.typosquat || i.hasCriticalOrHighAdvisory || malwarePattern) return 'high';

  if (
    i.deprecatedOrArchived ||
    (i.installScripts && (i.lowTrust || i.brandNew)) ||
    (i.lowTrust && i.flags.includes('single-maintainer'))
  ) {
    return 'medium';
  }
  return 'low';
}
