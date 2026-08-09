/**
 * Upgrade selection under a repo's `RepoPolicy.scope`.
 *
 * The dashboard has offered these three settings since the connect survey
 * shipped, and until now nothing read them: a repo set to `security` was still
 * handed every drifted dependency. A control that persists and displays but does
 * not govern is worse than no control, because the user reasonably believes the
 * blast radius is smaller than it is.
 *
 * Why this is the enforcement point: the plan is what the agent edits FROM. Any
 * later gate (the prompt, the PR step) would leave the out-of-scope upgrades in
 * the brief the model reads, and a model handed an upgrade it was told not to
 * make will sometimes make it. Filtering at the source is the only version of
 * this that is structural rather than advisory.
 *
 * What this is NOT: a visibility filter. Out-of-scope upgrades stay in the
 * response and stay in the report — they are marked, not deleted. A user in
 * `security` scope still wants to SEE that they are four majors behind on
 * something; they just did not consent to an agent rewriting it. Dropping the
 * rows would silently shrink the drift picture and hide exactly the information
 * that makes someone widen their scope later.
 */
import type { UpgradeBrief } from './brief';
import type { RepoPolicy } from './types';

/** Why an upgrade is not eligible for the agent, in words a user can act on. */
export type ScopeReason =
  | 'no advisory — scope is security-only'
  | 'nothing referenced breaks — scope is security + blocking'
  | 'surface not yet analysed — nothing for the agent to rewrite';

export interface ScopedUpgrade extends UpgradeBrief {
  /** May the agent attempt this one? */
  inScope: boolean;
  /** Set only when `inScope` is false. */
  scopeReason?: ScopeReason;
}

/**
 * An upgrade whose surface we could not diff carries an empty `removed`, so
 * there are no call sites for the agent to rewrite — attempting it would be a
 * blind version bump. Under `all` that is what the user asked for; under any
 * narrower scope it is precisely what they did not.
 */
function isUnassessed(u: UpgradeBrief): boolean {
  return u.verdict === 'unknown';
}

function breaksSomething(u: UpgradeBrief): boolean {
  return u.verdict === 'removes-exports' || u.verdict === 'arity-changed';
}

/** Decide one upgrade against one scope. Pure — the whole policy is right here. */
export function scopeVerdict(
  u: UpgradeBrief,
  scope: RepoPolicy['scope'],
): { inScope: true } | { inScope: false; reason: ScopeReason } {
  if (scope === 'all') return { inScope: true };

  // Security is the floor under every narrower scope: a repo that opted into
  // `blocking` is asking for MORE than advisories, never fewer.
  if (u.advisories > 0) return { inScope: true };

  if (scope === 'security') {
    return { inScope: false, reason: 'no advisory — scope is security-only' };
  }

  if (isUnassessed(u)) {
    return { inScope: false, reason: 'surface not yet analysed — nothing for the agent to rewrite' };
  }
  if (breaksSomething(u)) return { inScope: true };
  return { inScope: false, reason: 'nothing referenced breaks — scope is security + blocking' };
}

export interface ScopedPlan {
  upgrades: ScopedUpgrade[];
  /** The scope actually applied, so CI can print it rather than assume it. */
  scope: RepoPolicy['scope'];
  /**
   * Where the scope came from. `unconnected` means no policy governs this
   * checkout, which is a real and supported state — `upgrade-plan` works in any
   * clone, and connecting a repo is what opts into policy, not a precondition
   * for the loop.
   */
  scopeSource: 'repo-policy' | 'unconnected';
  /** How many upgrades the policy holds back. Printed, never silent. */
  outOfScope: number;
}

/**
 * Annotate a brief's upgrades with policy eligibility.
 *
 * `policy === null` (an unconnected checkout) means everything is in scope —
 * the same behaviour this endpoint has always had. Enforcement arrives with the
 * connection, so no existing workflow changes behaviour on deploy.
 */
export function applyScope(upgrades: UpgradeBrief[], policy: RepoPolicy | null): ScopedPlan {
  if (!policy) {
    return {
      upgrades: upgrades.map((u) => ({ ...u, inScope: true })),
      scope: 'all',
      scopeSource: 'unconnected',
      outOfScope: 0,
    };
  }

  const scoped = upgrades.map((u): ScopedUpgrade => {
    const verdict = scopeVerdict(u, policy.scope);
    return verdict.inScope ? { ...u, inScope: true } : { ...u, inScope: false, scopeReason: verdict.reason };
  });

  return {
    upgrades: scoped,
    scope: policy.scope,
    scopeSource: 'repo-policy',
    outOfScope: scoped.filter((u) => !u.inScope).length,
  };
}
