import { describe, it, expect } from 'vitest';
import { applyScope, scopeVerdict } from '../src/github/scope';
import type { UpgradeBrief } from '../src/github/brief';
import type { RepoPolicy } from '../src/github/types';

const upgrade = (over: Partial<UpgradeBrief> = {}): UpgradeBrief => ({
  package: 'left-pad',
  fromVersion: '1.0.0',
  toVersion: '2.0.0',
  declaredIn: [{ path: 'package.json', range: '^1.0.0' }],
  majorsBehind: 1,
  advisories: 0,
  deprecated: false,
  verdict: 'clean',
  removed: [],
  renamed: [],
  arityChanged: [],
  typeOnlyRemoved: [],
  newlyDeprecated: [],
  hops: [],
  ...over,
});

const policy = (scope: RepoPolicy['scope']): RepoPolicy => ({
  enabled: true,
  scope,
  autoMerge: false,
});

describe('scope: security', () => {
  it('admits an upgrade with an advisory', () => {
    expect(scopeVerdict(upgrade({ advisories: 1 }), 'security').inScope).toBe(true);
  });

  it('holds back a clean upgrade', () => {
    expect(scopeVerdict(upgrade(), 'security').inScope).toBe(false);
  });

  it('holds back a breaking upgrade with no advisory', () => {
    // The point of `security`: breakage is not a security event.
    const v = scopeVerdict(upgrade({ verdict: 'removes-exports', removed: ['useHistory'] }), 'security');
    expect(v.inScope).toBe(false);
  });
});

describe('scope: blocking', () => {
  it('keeps security as its floor', () => {
    expect(scopeVerdict(upgrade({ advisories: 2 }), 'blocking').inScope).toBe(true);
  });

  it('admits an upgrade that removes exports', () => {
    expect(scopeVerdict(upgrade({ verdict: 'removes-exports' }), 'blocking').inScope).toBe(true);
  });

  it('admits an arity change — silent misbehaviour still counts', () => {
    expect(scopeVerdict(upgrade({ verdict: 'arity-changed' }), 'blocking').inScope).toBe(true);
  });

  it('holds back a clean upgrade', () => {
    expect(scopeVerdict(upgrade(), 'blocking').inScope).toBe(false);
  });

  it('holds back an unanalysed surface rather than bumping blind', () => {
    // verdict `unknown` carries an empty `removed`, so there is nothing for the
    // agent to rewrite — attempting it would be a version bump with no analysis.
    const v = scopeVerdict(upgrade({ verdict: 'unknown' }), 'blocking');
    expect(v.inScope).toBe(false);
    expect(v.inScope === false && v.reason).toMatch(/not yet analysed/);
  });
});

describe('scope: all', () => {
  it('admits everything, including unanalysed surfaces', () => {
    for (const verdict of ['clean', 'unknown', 'removes-exports', 'arity-changed'] as const) {
      expect(scopeVerdict(upgrade({ verdict }), 'all').inScope).toBe(true);
    }
  });
});

describe('applyScope', () => {
  it('leaves an unconnected checkout entirely ungoverned', () => {
    // The behaviour this endpoint has always had. A repo nobody connected must
    // not inherit DEFAULT_REPO_POLICY's `blocking` and silently narrow.
    const plan = applyScope([upgrade(), upgrade({ package: 'chalk' })], null);
    expect(plan.scopeSource).toBe('unconnected');
    expect(plan.outOfScope).toBe(0);
    expect(plan.upgrades.every((u) => u.inScope)).toBe(true);
  });

  it('marks held-back upgrades without dropping them', () => {
    const plan = applyScope(
      [upgrade({ package: 'a', advisories: 1 }), upgrade({ package: 'b' })],
      policy('security'),
    );
    // Both survive — visibility is not the same thing as eligibility.
    expect(plan.upgrades).toHaveLength(2);
    expect(plan.outOfScope).toBe(1);
    expect(plan.upgrades.find((u) => u.package === 'b')?.inScope).toBe(false);
    expect(plan.upgrades.find((u) => u.package === 'b')?.scopeReason).toBeTruthy();
  });

  it('reports the scope it applied so CI can print it', () => {
    expect(applyScope([], policy('all')).scope).toBe('all');
    expect(applyScope([], policy('security')).scopeSource).toBe('repo-policy');
  });
});

/**
 * The mode the plan response carries.
 *
 * This is what makes the dashboard's autopilot toggle govern runs rather than
 * only new installs: lurq is Contents:read-only and cannot rewrite a committed
 * workflow or set a repository variable, so the workflow reads the mode from
 * this response instead.
 */
describe('applyScope: the mode it reports', () => {
  it('says pr when the repository is armed', () => {
    expect(applyScope([], policy('all')).mode).toBe('pr');
  });

  it('says comment when the repository is not armed', () => {
    expect(applyScope([], { ...policy('all'), enabled: false }).mode).toBe('comment');
  });

  it('omits the mode entirely for an unconnected checkout', () => {
    // Load bearing, and the reason this is not just `policy?.enabled`: "no
    // policy" is not "policy says comment". The workflow falls back to the mode
    // baked in when it was generated, so a server with no opinion about a repo
    // can never disarm one that armed itself.
    const plan = applyScope([upgrade()], null);
    expect(plan.mode).toBeUndefined();
    expect('mode' in plan).toBe(false);
  });
});
