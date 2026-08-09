/**
 * Repo-autopilot types.
 *
 * Scope discipline: lurq reads *manifests*, never source. A `package.json`
 * dependency block is the minimum input needed to compute drift, and it is also
 * the most we can read without breaking the promise the rest of the product is
 * built on ("lurq never sees your code"). The agent that eventually edits code
 * runs in the user's own CI, on their runner — see docs/lurq-autopilot.md.
 */
import type { CompatConflict } from '../core/types';

/** One `package.json` found in a repo. Monorepos yield several. */
export interface RepoManifest {
  /** Repo-relative path, e.g. `package.json` or `packages/api/package.json`. */
  path: string;
  /** Declared ranges, dependencies + devDependencies merged. */
  deps: Record<string, string>;
}

/** Where a dependency is declared. A monorepo declares the same package in
 *  several workspaces, often at different ranges — and an agent editing the
 *  upgrade needs the file list, not just the merged view. */
export interface DepDeclaration {
  /** Repo-relative manifest path. */
  path: string;
  range: string;
}

/** Per-dependency drift, computed against the lurq index. */
export interface DepDrift {
  name: string;
  /** Lowest range declared anywhere — the one that governs the repo's drift. */
  range: string;
  /** Every manifest declaring this package, with that manifest's own range. */
  declaredIn: DepDeclaration[];
  /** Highest indexed version the range admits — what a fresh install resolves to. */
  resolved: string | null;
  /** `packages.latest_version` at scan time. */
  latest: string | null;
  /** Major versions between `resolved` and `latest`. 0 = current. */
  majorsBehind: number;
  deprecated: boolean;
  /** Count of known advisories on the package. */
  advisories: number;
}

/** A resolved transitive dependency carrying a risk signal worth reporting. */
export interface TransitiveRisk {
  name: string;
  /** The exact installed version, from the resolved tree — no range guessing. */
  version: string;
  /** Latest known release, so "how stale is this" is answerable. */
  latest: string | null;
  /**
   * Advisories recorded against the PACKAGE, computed for its latest version and
   * NOT proven against `version`. Read it as "this package has known
   * advisories", never "this install is vulnerable" — `vulnerabilities` is the
   * field that answers the second question.
   */
  advisories: number;
  /**
   * OSV advisory ids matched to this EXACT version. An empty array is a real
   * all-clear: the package has a history, this install is not affected by it.
   *
   * `undefined` means the lookup did not complete, and must render as "not
   * checked" rather than as clean — same discipline as `transitive: null`. The
   * distinction matters most here, where a false all-clear is a security claim.
   */
  vulnerabilities?: string[];
  deprecated: boolean;
  /**
   * Direct dependencies whose tree pulls this in — the actual upgrade targets.
   *
   * Empty means the resolved tree carried no usable parentage, NOT that nothing
   * depends on this. Every node in a tree got there somehow, so an absence here
   * is always a gap in our data and the UI says so.
   */
  pulledInBy: string[];
}

/**
 * The resolved dependency tree beyond what `package.json` declares.
 *
 * Kept as its own block rather than folded into the direct-dependency counts,
 * because the two are fixed differently: a direct dependency you bump, a
 * transitive one you either wait for its parent or force an override. Adding
 * them together would produce a number nobody can act on.
 */
export interface TransitiveDrift {
  /** Total resolved npm nodes GitHub reported. */
  resolved: number;
  /** How many of those lurq has indexed — the rest carry no signal either way. */
  tracked: number;
  /** Indexed transitives whose package has known advisories. */
  advisoryPackages: number;
  /**
   * Installs OSV matched to a vulnerability at their exact resolved version —
   * the actionable count, as distinct from `advisoryPackages`, which counts
   * packages with any advisory history. The two are deliberately not merged:
   * one tells you to upgrade something, the other tells you a package has had
   * problems, and summing them would produce a number meaning neither.
   *
   * `undefined` when the OSV lookup could not complete. Never 0 in that case.
   */
  vulnerableInstalls?: number;
  /** Indexed transitives whose package is deprecated upstream. */
  deprecated: number;
  /** The worst of them, ranked. Capped — see TRANSITIVE_DETAIL_CAP. */
  risks: TransitiveRisk[];
  /** True when the tree exceeded the node cap and is therefore incomplete. */
  truncated: boolean;
  /** True when the SBOM carried usable DEPENDS_ON edges, so `pulledInBy` is
   *  meaningful. False means blame paths were unavailable for the whole repo. */
  attributed: boolean;
}

/**
 * Repo-level drift summary, recomputed on every scan and stored denormalized so
 * the dashboard reads one row per repo instead of joining the whole index.
 */
export interface RepoDrift {
  /** Distinct dependencies declared across all manifests. */
  depsDeclared: number;
  /** How many of those lurq has indexed. The rest are `unknown` — never
   *  silently counted as current (same discipline as `unverified` in
   *  src/surface/upgrade.ts: not-looked-at must never read as fine). */
  depsTracked: number;
  /** Tracked deps at least one major behind. */
  majorDrift: number;
  /** Tracked deps behind at all (any semver level). */
  anyDrift: number;
  /** Tracked deps flagged deprecated upstream. */
  deprecated: number;
  /** Total advisories across tracked deps. */
  advisories: number;
  /** Per-dep detail, worst-drift first. Capped — see REPO_DRIFT_DETAIL_CAP. */
  deps: DepDrift[];
  /**
   * The resolved tree beyond the manifest. Null when the repo has no dependency
   * graph enabled — which is "we could not look", not "nothing is there", and
   * the dashboard renders the two differently.
   */
  transitive: TransitiveDrift | null;
  /**
   * Peer-dependency and engine conflicts across the tracked dependencies **at
   * their latest versions** — i.e. what breaks if the repo takes the upgrades in
   * its own migration brief. Not the state of the current install: that needs
   * each pinned version's own manifest, which is a registry read per dependency.
   *
   * `undefined` means the repo has not been scanned since this check shipped, and
   * is rendered as "not checked" rather than as a clean stack — same rule as
   * `transitive: null`. An empty array is a real all-clear.
   */
  conflictsAtLatest?: CompatConflict[];
  /**
   * Peer/engine conflicts in the versions the repo resolves TODAY — i.e. whether
   * this stack is broken right now, as opposed to whether the upgrades we are
   * recommending would land somewhere coherent.
   *
   * Same `undefined` discipline as `conflictsAtLatest`: absent means the repo has
   * not been scanned since this shipped and renders as "not checked", never as a
   * clean install. An empty array is a real all-clear.
   */
  conflictsAtCurrent?: CompatConflict[];
}

/** Per-repo autopilot policy. Set by the connect survey, edited in the dashboard. */
export interface RepoPolicy {
  /** Master switch. Connecting a repo does not arm it. */
  enabled: boolean;
  /**
   * Which upgrades the agent may attempt.
   *   `security` — only deps with advisories
   *   `blocking` — security, plus upgrades whose surface diff removes a symbol
   *                the code references (the ones that break silently)
   *   `all`      — every drifted dependency
   */
  scope: 'security' | 'blocking' | 'all';
  /**
   * Merge the PR when the repo's own CI passes. Opt-in per repo, and it is the
   * only setting that lets lurq change a default branch. Default false, always.
   */
  autoMerge: boolean;
}

export const DEFAULT_REPO_POLICY: RepoPolicy = {
  enabled: false,
  scope: 'blocking',
  autoMerge: false,
};

/**
 * What the CI check concluded about one upgrade, straight from `checkUpgrade`.
 * `unverified` is a first-class outcome and is never rolled into `ok` — a check
 * that could not run is not a check that passed.
 */
export type UpgradeSeverity = 'blocking' | 'warning' | 'ok' | 'unverified';

/**
 * How far one upgrade got through the loop.
 *   checked  — analysed only (comment mode, or the agent step was not armed)
 *   skipped  — policy excluded it
 *   edited   — the agent changed code but the run stopped before a PR
 *   pr_open  — a pull request exists
 *   merged   — that PR landed
 *   failed   — the edit or the repo's own checks failed
 */
export type UpgradeRunStatus =
  | 'checked'
  | 'skipped'
  | 'edited'
  | 'pr_open'
  | 'merged'
  | 'failed';

export const UPGRADE_SEVERITIES: UpgradeSeverity[] = ['blocking', 'warning', 'ok', 'unverified'];
export const UPGRADE_RUN_STATUSES: UpgradeRunStatus[] = [
  'checked',
  'skipped',
  'edited',
  'pr_open',
  'merged',
  'failed',
];

/** Manifests scanned per repo. A monorepo with more workspaces than this reports
 *  partial coverage rather than silently truncating — see scanRepo. */
export const REPO_MANIFEST_CAP = 25;

/** Per-dep drift rows persisted. The summary counts are always exact; only the
 *  detail list is capped, and the dashboard says so when it truncates. */
export const REPO_DRIFT_DETAIL_CAP = 200;

/** Transitive risk rows persisted. Counts above the list stay exact. */
export const TRANSITIVE_DETAIL_CAP = 100;
