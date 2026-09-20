/**
 * Selection policy — what an agent is allowed to *add*, as opposed to what it
 * is allowed to *upgrade*.
 *
 * `RepoPolicy` (github/types) governs upgrades to dependencies a repo already
 * has. This governs the other half: the packages an agent reaches for when it
 * writes new code. Nothing else in the ecosystem sits at that moment — Renovate,
 * Dependabot and Snyk all act on a manifest that already contains the choice.
 * lurq is in the agent's loop over MCP, so it is the one place a bad pick can be
 * caught before it becomes a line in package.json and, a month later, a
 * migration.
 *
 * Scoped by owner id, not by a new organisation entity. `api_keys.owner_id` and
 * `repos.owner_id` are already Clerk ids, and Clerk namespaces its ids by prefix
 * (`user_…` / `org_…`), so the day organisations are switched on this column
 * holds an org id with no migration and no membership tables. Building a
 * membership model before a single customer has asked for one is exactly the
 * speculative work this file should not contain.
 * ponytail: owner-scoped; when Clerk orgs land, `ownerId` holds `org_…`.
 */
import type { Advisory, AdvisorySeverity, Confidence } from '../core/types';

/** One package the policy refuses, with the reason an agent can act on. */
export interface DenyRule {
  name: string;
  /** Shown verbatim to the agent — "use our internal fork" beats "denied". */
  reason?: string;
}

/**
 * A package every rule lets through.
 *
 * Carries a reason and an optional expiry because a permanent, unexplained
 * exception is how a policy rots: a year later nobody knows why the GPL parser
 * is allowed or whether the reason still holds. An expiry forces the question
 * to be asked again; the reason tells whoever asks it what was decided.
 */
export interface AllowRule {
  name: string;
  reason?: string;
  /** First day (YYYY-MM-DD, UTC) the exception no longer applies. Absent = permanent. */
  expires?: string;
}

/**
 * `enforce` refuses. `warn` reports what would have been refused and lets it
 * through, which is how a rule gets rolled out: see what it would catch across
 * real agent traffic before it is allowed to block anyone.
 */
export type PolicyMode = 'enforce' | 'warn';

export interface SelectionPolicy {
  mode: PolicyMode;
  /**
   * Always allowed, evaluated before every other rule. This is the escape hatch
   * for the package a team has deliberately accepted despite the rules — an
   * unmaintained-but-vendored parser, a GPL tool used only in a build step.
   * Without it, any rule strong enough to be useful is also strong enough to be
   * switched off entirely the first time it is inconvenient.
   */
  allow: AllowRule[];
  /** Never recommended. Beats everything except `allow`. */
  deny: DenyRule[];
  /**
   * Floor on lurq's own evidence confidence. `null` = no rule, which is the
   * default: a team that has not thought about this should not silently inherit
   * a bar that hides half the index from their agent.
   */
  minConfidence: Confidence | null;
  /**
   * SPDX identifiers the org accepts. `null` = no rule. Never `[]` for "no
   * rule" — an empty allowlist reads as "allow nothing", and the difference
   * between those two is a policy that blocks every package on the first save.
   */
  licenses: string[] | null;
  /** Refuse packages npm has marked deprecated. */
  blockDeprecated: boolean;
  /**
   * Refuse packages whose source repository is archived upstream.
   *
   * Distinct from `blockDeprecated` and worth its own rule: deprecation is a
   * publisher telling you to stop, archiving is a maintainer walking away
   * without telling anyone. Most packages that end up unmaintained never get a
   * deprecation notice at all, so a policy that only reads the npm flag catches
   * the polite half of the problem.
   */
  blockArchived: boolean;
  /**
   * Refuse packages carrying a known advisory at or above this severity.
   * `null` = no rule.
   *
   * The floor is expressed as the *worst tolerated* level, not the blocked one:
   * teams reason in "nothing high or above", and the inverse phrasing is the
   * kind that gets set backwards once and then trusted for a year.
   */
  maxAdvisorySeverity: AdvisorySeverity | null;
  /**
   * Adoption floor, in weekly npm downloads. `null` = no rule.
   *
   * A blunt instrument on purpose — it is the one signal every engineer already
   * has an intuition for, and it exists so a team can say "nothing nobody else
   * runs in production" without having to reason about our evidence grades.
   */
  minWeeklyDownloads: number | null;
  /**
   * Refuse packages with no release in this many months. `null` = no rule.
   *
   * Months, not days: this is a judgement about maintenance, and a rule set in
   * days invites a precision the underlying signal does not have. A stable,
   * finished library is the known false positive here, which is exactly what
   * `allow` is for.
   */
  maxStaleMonths: number | null;
  /**
   * Ceiling on minified+gzipped bundle size, in KB. `null` = no rule.
   *
   * Only meaningful for packages that ship to a browser, and the fact is absent
   * for the rest — which, per "absent facts never convict", means a backend
   * dependency is never refused by a size rule someone set for the frontend.
   */
  maxBundleKb: number | null;
  /**
   * Refuse packages first published fewer than this many days ago. `null` = no rule.
   *
   * A cool-down, as package firewalls call it. Malware, maintainer-account
   * takeovers and names squatted because a model hallucinated them are all
   * youngest in their first days on the registry, before anyone has looked.
   * Measured from the package's first publish, not its latest release: lurq
   * rules on which package to add, and a mature package's new patch is not
   * what this rule is about.
   */
  minPackageAgeDays: number | null;
}

/**
 * Off. Connecting a repo does not arm autopilot, and having an owner record
 * does not arm selection policy — the same rule, for the same reason. A policy
 * that starts enforcing rules nobody set is indistinguishable from a bug.
 */
export const DEFAULT_SELECTION_POLICY: SelectionPolicy = {
  mode: 'enforce',
  allow: [],
  deny: [],
  minConfidence: null,
  licenses: null,
  blockDeprecated: false,
  blockArchived: false,
  maxAdvisorySeverity: null,
  minWeeklyDownloads: null,
  maxStaleMonths: null,
  maxBundleKb: null,
  minPackageAgeDays: null,
};

/** Which rule refused a package. */
export type ExclusionRule =
  | 'denied'
  | 'advisory'
  | 'license'
  | 'deprecated'
  | 'archived'
  | 'confidence'
  | 'adoption'
  | 'stale'
  | 'size'
  | 'age';

/**
 * A package the policy removed, and why.
 *
 * Excluded candidates are *reported*, never silently dropped. An agent told
 * "here are 3 options" when 5 were found will happily re-derive the blocked one
 * from its own training and install it directly; an agent told "axios is denied:
 * use the internal http client" routes around the rule correctly. The reason is
 * the part that does the work.
 */
export interface Exclusion {
  name: string;
  rule: ExclusionRule;
  reason: string;
}

/**
 * Package facts the policy needs that `Candidate` does not carry.
 *
 * Every field is nullable and every rule abstains on a null: the loader reports
 * what the index knows, and "we have not established this" must never read as
 * either a violation or an all-clear.
 *
 * `monthsSinceRelease` is derived by the loader rather than in `check` on
 * purpose — enforcement stays a pure function of (policy, package, facts) with
 * no clock, which is what makes the rules exhaustively testable. The clock
 * belongs to the layer that reads the row.
 */
export interface PolicyFacts {
  license: string | null;
  deprecated: boolean;
  archived?: boolean;
  /** Known advisories. Order is not assumed — `check` takes the worst. */
  advisories?: Advisory[] | null;
  weeklyDownloads?: number | null;
  /** Whole months between the last published release and the read. */
  monthsSinceRelease?: number | null;
  /** Minified + gzipped, in KB. Null for anything not size-measured. */
  bundleKb?: number | null;
  /** Whole days since the package was first published. */
  daysSincePublished?: number | null;
}

/**
 * What the policy says about one specific package.
 *
 * Present on `evaluate` only when a policy is in force. Its absence means "no
 * rules configured", never "allowed" — the two are different claims and an agent
 * reading a missing field as approval is exactly the failure this whole layer
 * exists to prevent.
 */
export type PolicyVerdict =
  // `warning` is set in warn mode: the package broke a rule that is not yet enforced.
  { allowed: true; warning?: Exclusion } | ({ allowed: false } & Exclusion);
