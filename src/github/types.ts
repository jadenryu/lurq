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

/** Per-dependency drift, computed against the lurq index. */
export interface DepDrift {
  name: string;
  /** Declared range from the manifest, e.g. `^6.4.0`. */
  range: string;
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

/** Manifests scanned per repo. A monorepo with more workspaces than this reports
 *  partial coverage rather than silently truncating — see scanRepo. */
export const REPO_MANIFEST_CAP = 25;

/** Per-dep drift rows persisted. The summary counts are always exact; only the
 *  detail list is capped, and the dashboard says so when it truncates. */
export const REPO_DRIFT_DETAIL_CAP = 200;
