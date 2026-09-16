/**
 * Check permissions on a repo policy.
 *
 * The failure this guards is not a wrong answer, it is a SILENT one: the stored
 * policy is replaced wholesale on every save and the dashboard PATCHes the
 * whole object, so a permission that is not carried through disappears the next
 * time someone toggles an unrelated setting — no error, nothing in the
 * response, and the user believes a check is still running.
 *
 * The other half is direction of default. `inScope` reads absent as UNGOVERNED
 * so an older server keeps working; a permission must read absent as NOT
 * GRANTED, because the harm runs the other way.
 */
import { describe, expect, it } from 'vitest';
import { permits } from '../src/github/scope';
import { DEFAULT_REPO_POLICY, type RepoPolicy } from '../src/github/types';

const policy = (over: Partial<RepoPolicy> = {}): RepoPolicy => ({
  enabled: false,
  scope: 'blocking',
  autoMerge: false,
  ...over,
});

describe('permits', () => {
  it('grants a check the policy explicitly sets', () => {
    expect(permits(policy({ checks: { env: true } }), 'env')).toBe(true);
  });

  it('denies a check the policy explicitly clears', () => {
    // The only way off, and it has to survive every other save.
    expect(permits(policy({ checks: { env: false } }), 'env')).toBe(false);
  });

  it('grants a check the policy never mentions', () => {
    // The split rule: consent is required for WRITES, not for READS. This check
    // reads the project's own files, needs no key, reaches no network and fails
    // no build, so absent means on. Requiring a decision for no risk taken is
    // what left every already-connected repo unable to get it.
    expect(permits(policy(), 'env')).toBe(true);
    expect(permits(policy({ checks: {} }), 'env')).toBe(true);
  });

  it('grants when there is no policy at all', () => {
    // An unconnected checkout: upgrade-plan works in any clone, and nothing
    // this grants can write. A future WRITE permission must not use permits().
    expect(permits(null, 'env')).toBe(true);
  });

  it('treats only a literal false as a decision to turn it off', () => {
    // A policy round-trips through JSON. None of these is the `false` a user
    // sets by clicking the toggle, so none of them may switch the check off —
    // the same reasoning as the old `=== true`, pointed the other way.
    for (const value of ['false', 'true', 1, 0, {}, []] as unknown[]) {
      expect(
        permits(policy({ checks: { env: value as boolean } }), 'env'),
        JSON.stringify(value),
      ).toBe(true);
    }
  });
});

describe('DEFAULT_REPO_POLICY', () => {
  it('still arms nothing: connecting a repo does not grant the agent anything', () => {
    expect(DEFAULT_REPO_POLICY.enabled).toBe(false);
    expect(DEFAULT_REPO_POLICY.autoMerge).toBe(false);
  });

  it('grants the read-only env check, which writes nothing and needs no key', () => {
    expect(permits(DEFAULT_REPO_POLICY, 'env')).toBe(true);
  });

  it('behaves identically whether the default is written or absent', () => {
    // The point of the inversion: a repo connected before checks existed must
    // get the same answer as a newly connected one. If these two ever diverge,
    // the permissive default is not actually reaching old policies.
    const { checks: _checks, ...withoutChecks } = DEFAULT_REPO_POLICY;
    expect(permits(withoutChecks as RepoPolicy, 'env')).toBe(
      permits(DEFAULT_REPO_POLICY, 'env'),
    );
  });

  it('holds every check to the condition that makes on-by-default honest', () => {
    // Not a shape assertion — presence no longer grants anything, absence does.
    // What has to stay true is that every member of `checks` is read-only: no
    // key, no network, no writes, unable to fail a build. That is the contract
    // for adding a field here instead of to a future `writes` block, and it is
    // stated in RepoPolicy. Listed so a new entry has to face this test.
    expect(Object.keys(DEFAULT_REPO_POLICY.checks ?? {})).toEqual(['env']);
  });
});
