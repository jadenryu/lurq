/**
 * Repo-autopilot types.
 *
 * Scope discipline: lurq reads *manifests*, never source. A `package.json`
 * dependency block is the minimum input needed to compute drift, and it is also
 * the most we can read without breaking the promise the rest of the product is
 * built on ("lurq never sees your code"). The agent that eventually edits code
 * runs in the user's own CI, on their runner — see docs/lurq-autopilot.md.
 */

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
