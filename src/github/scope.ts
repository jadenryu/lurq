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
import type { RepoCheck, RepoPolicy } from './types';

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
 * Does this repo's policy grant a check?
 *
 * One accessor, because a permission spelled four different ways across a
 * codebase is a permission that is accidentally truthy somewhere.
 *
 * THE RULE, and it is a split rather than one default: consent is required for
 * WRITES, not for READS. A check here reads the project's own files, needs no
 * key, reaches no network, writes nothing and fails no build — so it is on
 * unless someone turns it off (`!== false`). A permission that lets lurq or an
 * agent CHANGE something stays off unless explicitly granted, and the next
 * field added to this policy should follow whichever half it belongs to.
 *
 * This inverts what shipped in 47b39a9, deliberately. Absent-means-denied left
 * every already-connected repo unable to get a read-only check without finding
 * a toggle, which is a decision asked of the user for no risk taken — the
 * definition of friction. `=== false` is still explicit: a user who turned it
 * off stays off, and only that.
 *
 * `!== false` rather than a truthy test for the same reason the old code used
 * `=== true`: a policy round-trips through JSON, and neither `"false"` nor a
 * missing key should be read as a decision the user made.
 *
 * A null policy — an unconnected checkout, or a plan from a server predating
 * policies — therefore reads as ON, and that is the right answer for a
 * read-only check: `upgrade-plan` works in any clone, and nothing here writes.
 * A future write permission must NOT reuse this accessor for that reason.
 */
export function permits(policy: RepoPolicy | null, check: RepoCheck): boolean {
  return policy?.checks?.[check] !== false;
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
    return {
      inScope: false,
      reason: 'surface not yet analysed — nothing for the agent to rewrite',
    };
  }
  if (breaksSomething(u)) return { inScope: true };
  return { inScope: false, reason: 'nothing referenced breaks — scope is security + blocking' };
}

/**
 * How far this repo's workflow may go, from its policy.
 *
 * One implementation on purpose. `mode` is optional on RepoPolicy and an absent
 * value has to read as the behaviour that shipped before the field existed —
 * armed meant the agent. Spelling that fallback at each call site is how one of
 * them eventually spells it differently and a repo silently changes what it is
 * allowed to do.
 */
export function repoMode(policy: RepoPolicy): 'comment' | 'fix' | 'pr' {
  // `enabled` first, and this order is the whole correctness of the function.
  // Reading `mode` first meant a repo that had once chosen `pr` kept resolving
  // to `pr` after autopilot was switched OFF — the master switch would stop
  // disarming anything, which is the one thing it exists to do.
  if (!policy.enabled) return 'comment';
  // Armed with no mode is every policy stored before the field existed, and
  // armed meant the agent then, so that is what it has to keep meaning.
  return policy.mode ?? 'pr';
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
  /**
   * What this repository's dashboard setting says the job should do:
   * `comment` to analyse only, `fix` to open a pull request with only the
   * changes lurq can prove, `pr` to also hand the rest to the agent.
   *
   * Here because the toggle on the dashboard was otherwise a no-op for any
   * workflow already committed. lurq's GitHub App is Contents:read-only — it
   * cannot rewrite that file or set a repository variable — so the mode has to
   * be something the workflow READS, and this response is one it already
   * fetches on every run.
   *
   * Absent when no policy governs the checkout, and that absence is load
   * bearing: the workflow falls back to the mode baked in when it was
   * generated, so a server with no opinion never disarms a repo.
   */
  mode?: 'comment' | 'fix' | 'pr';
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
    return verdict.inScope
      ? { ...u, inScope: true }
      : { ...u, inScope: false, scopeReason: verdict.reason };
  });

  return {
    upgrades: scoped,
    scope: policy.scope,
    scopeSource: 'repo-policy',
    outOfScope: scoped.filter((u) => !u.inScope).length,
    // Only on this branch. The unconnected branch above deliberately omits it:
    // "no policy" is not "policy says comment", and conflating them would turn
    // an unconnected checkout into a silent disarm.
    mode: repoMode(policy),
  };
}
