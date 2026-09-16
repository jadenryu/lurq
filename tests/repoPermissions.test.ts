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
    expect(permits(policy({ checks: { env: false } }), 'env')).toBe(false);
  });

  it('denies a check the policy never mentions', () => {
    // A policy stored before checks existed has no such key. Absent must read
    // as not granted rather than inherit whatever the default now says.
    expect(permits(policy(), 'env')).toBe(false);
    expect(permits(policy({ checks: {} }), 'env')).toBe(false);
  });

  it('denies when there is no policy at all', () => {
    // A repo with no record, or a plan from a server predating policies.
    expect(permits(null, 'env')).toBe(false);
  });

  it('is not fooled by a truthy value that is not true', () => {
    // A policy round-trips through JSON, and "false" is truthy.
    for (const value of ['false', 'true', 1, {}, []] as unknown[]) {
      expect(
        permits(policy({ checks: { env: value as boolean } }), 'env'),
        JSON.stringify(value),
      ).toBe(false);
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

  it('does not grant a check by being merely present', () => {
    // Guards the shape, not the value: if `checks` ever gains a field, adding
    // it must be a deliberate grant rather than something a spread turns on.
    expect(Object.keys(DEFAULT_REPO_POLICY.checks ?? {})).toEqual(['env']);
  });
});
