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
import type { Confidence } from '../core/types';

/** One package the policy refuses, with the reason an agent can act on. */
export interface DenyRule {
  name: string;
  /** Shown verbatim to the agent — "use our internal fork" beats "denied". */
  reason?: string;
}

export interface SelectionPolicy {
  /**
   * Always allowed, evaluated before every other rule. This is the escape hatch
   * for the package a team has deliberately accepted despite the rules — an
   * unmaintained-but-vendored parser, a GPL tool used only in a build step.
   * Without it, any rule strong enough to be useful is also strong enough to be
   * switched off entirely the first time it is inconvenient.
   */
  allow: string[];
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
}

/**
 * Off. Connecting a repo does not arm autopilot, and having an owner record
 * does not arm selection policy — the same rule, for the same reason. A policy
 * that starts enforcing rules nobody set is indistinguishable from a bug.
 */
export const DEFAULT_SELECTION_POLICY: SelectionPolicy = {
  allow: [],
  deny: [],
  minConfidence: null,
  licenses: null,
  blockDeprecated: false,
};

/** Which rule refused a package. */
export type ExclusionRule = 'denied' | 'license' | 'deprecated' | 'confidence';

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

/** Package facts the policy needs that `Candidate` does not carry. */
export interface PolicyFacts {
  license: string | null;
  deprecated: boolean;
}

/**
 * What the policy says about one specific package.
 *
 * Present on `evaluate` only when a policy is in force. Its absence means "no
 * rules configured", never "allowed" — the two are different claims and an agent
 * reading a missing field as approval is exactly the failure this whole layer
 * exists to prevent.
 */
export type PolicyVerdict = { allowed: true } | ({ allowed: false } & Exclusion);
