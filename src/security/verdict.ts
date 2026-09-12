/**
 * The single answer to "is it safe to install this?".
 *
 * This exists because lurq had several. `verify` rolled risk flags into a
 * level, `evaluate` reported a health score and a confidence tier, and `audit`
 * emitted findings — three code paths deriving safety from overlapping inputs
 * and disagreeing about the same package. A tool that answers one question
 * three ways has not answered it, and the disagreement always surfaced at the
 * worst moment, because the paths diverge exactly where the evidence is thin.
 *
 * Every surface now calls this and renders what it returns. Adding a signal
 * means editing one file, and no caller can accidentally be more reassuring
 * than the evidence supports.
 *
 * Three rules, each of which was a real defect:
 *
 *  1. A SECURITY FINDING OVERRIDES QUALITY. A package with a known advisory is
 *     not "safe" because it is popular and well maintained. The health score
 *     stays a quality measure — it is not fudged — but it never sets the
 *     verdict, and the verdict is what every surface leads with.
 *
 *  2. UNKNOWN IS NOT CLEAN. `advisories` is NULL until the package has been
 *     analysed and `[]` once it has, and collapsing those with `?? []` reported
 *     "0 advisories" for a package nobody had looked at yet. Missing evidence
 *     is carried in `unknowns` and suppresses reassurance outright.
 *
 *  3. A NAME THAT DOES NOT EXIST IS NOT A RISK RATING. It is bad input, and
 *     saying "high risk" invites the reader to weigh it against a benefit. There
 *     is no package to weigh.
 */
import type { Advisory, RiskLevel } from '../core/types';

/**
 * `invalid` is deliberately outside `RiskLevel`: it is a statement about the
 * INPUT, not about a package, and flattening it into `high` loses the only
 * thing the caller can act on — that there is nothing here to install.
 */
export type VerdictLevel = RiskLevel | 'invalid';

export interface SecurityVerdict {
  level: VerdictLevel;
  /** Why this is not clean, worst first. Empty only when nothing was found. */
  reasons: string[];
  /**
   * What was NOT established. Non-empty means `level` is provisional: it is the
   * worst we can currently justify, not the worst that is true.
   */
  unknowns: string[];
  /** Every input needed to justify a clean bill was present. */
  complete: boolean;
  /**
   * Safe to render as reassurance ("looks safe", a green tick).
   *
   * The one flag every renderer must consult. It requires a low level AND no
   * findings AND nothing unchecked, so a caller cannot produce a green tick
   * over a gap in the evidence by reading `level` alone.
   */
  reassuring: boolean;
  /** Advisories actually recorded. Null when none have been fetched yet. */
  advisoryCount: number | null;
  /**
   * WHICH version this verdict is about, in words a reader can act on.
   *
   * Without it the surfaces agree and still mislead. `verify vitest` answers
   * about the latest release and says "no problems found"; the audit answers
   * about the 2.1.9 you have installed and says "vulnerable". Both are correct
   * and they read as a contradiction, because neither said what it was talking
   * about. A clean bill for the newest version is not a clean bill for the one
   * running in your node_modules.
   */
  scope: string;
}

export interface VerdictInput {
  /** False means the registry has no such package. */
  exists: boolean;
  /**
   * Advisories for the package. NULL means NOT YET CHECKED and must not be
   * passed as `[]` — that is the distinction this whole module protects.
   */
  advisories: Advisory[] | null;
  /** A popular package this name closely mimics. */
  typosquatOf?: string | null;
  installScripts?: boolean;
  brandNew?: boolean;
  /** Few or unknown downloads. */
  lowTrust?: boolean;
  deprecated?: boolean;
  archived?: boolean;
  singleMaintainer?: boolean;
  /** OSV ids matched to the EXACT installed version, when one was checked. */
  versionVulns?: string[] | null;
  /** False when a vulnerability lookup was attempted and did not complete. */
  vulnLookupComplete?: boolean;
  /** The version this verdict describes. */
  subjectVersion?: string | null;
  /** True when `subjectVersion` is what the user has installed, not the latest. */
  subjectInstalled?: boolean;
}

const SEVERE = new Set(['critical', 'high']);

function describeScope(i: VerdictInput): string {
  if (!i.exists) return 'this name';
  if (!i.subjectVersion) {
    return i.subjectInstalled ? 'the installed version' : 'the latest published version';
  }
  return i.subjectInstalled ? `the installed ${i.subjectVersion}` : `${i.subjectVersion} (latest)`;
}

export function hasSevereAdvisory(advisories: Advisory[]): boolean {
  return advisories.some((a) => SEVERE.has(a.severity));
}

export function assessVerdict(i: VerdictInput): SecurityVerdict {
  const reasons: string[] = [];
  const unknowns: string[] = [];

  // Bad input, answered as bad input. A name nobody publishes is not a package
  // with a high risk score; it is a name the caller should stop using, and very
  // often a hallucination or a typo the agent was one command from installing.
  if (!i.exists) {
    return {
      level: 'invalid',
      reasons: [
        i.typosquatOf
          ? `no such package on npm — the name closely mimics "${i.typosquatOf}", which is what a typosquat looks like. Do not install it; check the spelling you meant.`
          : 'no such package on npm. This name does not exist, so there is nothing to assess — check the spelling, or that you are not recalling a package that was never published.',
      ],
      unknowns: [],
      complete: true,
      reassuring: false,
      advisoryCount: null,
      scope: describeScope(i),
    };
  }

  // NULL is "not analysed yet", `[]` is "analysed, nothing found". Treating the
  // first as the second is how an unanalysed package reported a clean bill.
  const analysed = i.advisories !== null;
  const advisories = i.advisories ?? [];
  if (!analysed) {
    unknowns.push('advisories have not been checked for this package yet');
  }
  if (i.vulnLookupComplete === false) {
    unknowns.push('the vulnerability lookup did not complete, so results are partial');
  }

  const severe = hasSevereAdvisory(advisories);
  const versionVulns = i.versionVulns ?? [];

  if (i.typosquatOf) {
    reasons.push(`name closely mimics "${i.typosquatOf}" — possible typosquat`);
  }
  if (versionVulns.length) {
    reasons.push(
      `the installed version is affected by ${versionVulns.length} advisory(ies): ${versionVulns.slice(0, 4).join(', ')}`,
    );
  }
  if (severe) {
    const worst = advisories.filter((a) => SEVERE.has(a.severity));
    reasons.push(`${worst.length} critical/high advisory(ies) recorded against this package`);
  }
  // Classic malware fingerprint: brand-new, runs install hooks, nobody uses it.
  const malwarePattern = Boolean(i.installScripts && i.brandNew && i.lowTrust);
  if (malwarePattern) {
    reasons.push(
      'published within the last 7 days, runs install scripts, and has almost no adoption — the shape of a malicious package',
    );
  }

  if (i.typosquatOf || versionVulns.length || severe || malwarePattern) {
    return {
      level: 'high',
      reasons,
      unknowns,
      complete: analysed && i.vulnLookupComplete !== false,
      reassuring: false,
      advisoryCount: analysed ? advisories.length : null,
      scope: describeScope(i),
    };
  }

  // A moderate or low advisory used to add a flag and leave the level at `low`,
  // so the same response said "has-known-advisory" and "looks safe". Any
  // recorded advisory is now at least a medium: it may not warrant refusing the
  // package, but it always warrants the reader knowing before they install.
  if (advisories.length > 0) {
    reasons.push(
      `${advisories.length} advisory(ies) recorded against this package (none critical or high)`,
    );
  }
  if (i.deprecated) reasons.push('the publisher has marked this package deprecated');
  if (i.archived) reasons.push('the source repository is archived');
  if (i.installScripts && (i.lowTrust || i.brandNew)) {
    reasons.push('runs install scripts and has little adoption or history');
  }
  if (i.lowTrust && i.singleMaintainer) {
    reasons.push('a single maintainer and very low adoption');
  }

  if (reasons.length > 0) {
    return {
      level: 'medium',
      reasons,
      unknowns,
      complete: analysed && i.vulnLookupComplete !== false,
      reassuring: false,
      advisoryCount: analysed ? advisories.length : null,
      scope: describeScope(i),
    };
  }

  const complete = analysed && i.vulnLookupComplete !== false;
  return {
    level: 'low',
    reasons: [],
    unknowns,
    complete,
    // The only path that produces a green tick, and it requires the evidence to
    // be complete. An unanalysed package reads as "not checked yet", never as
    // "nothing wrong with it".
    reassuring: complete,
    advisoryCount: analysed ? advisories.length : null,
    scope: describeScope(i),
  };
}

/** One line a renderer can print verbatim. Never reassuring unless it can be. */
export function verdictHeadline(v: SecurityVerdict): string {
  if (v.level === 'invalid') return 'NOT A REAL PACKAGE';
  if (v.level === 'high') return `do not install ${v.scope} without review`;
  if (v.level === 'medium') return `${v.scope}: usable, but read the findings first`;
  if (!v.complete) return `no problems found in ${v.scope}, but the check is incomplete`;
  return `no supply-chain problems found in ${v.scope}`;
}
