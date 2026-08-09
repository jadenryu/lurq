import { describe, expect, it } from 'vitest';
import { applyPolicy, check, hasRules } from '../src/policy/enforce';
import { DEFAULT_SELECTION_POLICY, type SelectionPolicy } from '../src/policy/types';
import type { Candidate, Confidence } from '../src/core/types';

function candidate(name: string, confidence: Confidence = 'proven'): Candidate {
  return {
    name,
    category: null,
    healthScore: 80,
    qualityScore: 80,
    confidence,
    why: 'test',
    latestVersion: '1.0.0',
    weeklyDownloads: 1000,
    lastReleaseAt: null,
    repoUrl: null,
  };
}

const policy = (over: Partial<SelectionPolicy> = {}): SelectionPolicy => ({
  ...DEFAULT_SELECTION_POLICY,
  ...over,
});

describe('hasRules', () => {
  it('is false for the default policy, so the free path skips the facts query', () => {
    expect(hasRules(DEFAULT_SELECTION_POLICY)).toBe(false);
  });

  it('treats an empty license allowlist as a rule, not as absence of one', () => {
    // `licenses: []` allows nothing. Reading it as "no rule" would silently
    // ignore a policy someone deliberately saved.
    expect(hasRules(policy({ licenses: [] }))).toBe(true);
  });

  it('counts each rule kind', () => {
    expect(hasRules(policy({ deny: [{ name: 'x' }] }))).toBe(true);
    expect(hasRules(policy({ minConfidence: 'proven' }))).toBe(true);
    expect(hasRules(policy({ blockDeprecated: true }))).toBe(true);
    // `allow` alone is not a rule — it only ever creates exceptions to others.
    expect(hasRules(policy({ allow: ['x'] }))).toBe(false);
  });
});

describe('check', () => {
  it('lets an explicit allow beat every other rule', () => {
    const p = policy({
      allow: ['left-pad'],
      deny: [{ name: 'left-pad' }],
      blockDeprecated: true,
      minConfidence: 'proven',
      licenses: ['MIT'],
    });
    const facts = { license: 'GPL-3.0', deprecated: true };
    expect(check(p, candidate('left-pad', 'unproven'), facts)).toBeNull();
  });

  it('reports the deny reason verbatim, because that is what the agent acts on', () => {
    const p = policy({ deny: [{ name: 'axios', reason: 'Use the internal http client.' }] });
    expect(check(p, candidate('axios'), undefined)).toEqual({
      name: 'axios',
      rule: 'denied',
      reason: 'Use the internal http client.',
    });
  });

  it('falls back to a generic reason when none is given', () => {
    const p = policy({ deny: [{ name: 'axios' }] });
    expect(check(p, candidate('axios'), undefined)?.reason).toMatch(/selection policy/i);
  });

  it('blocks deprecated packages only when the rule is on', () => {
    const facts = { license: 'MIT', deprecated: true };
    expect(check(policy(), candidate('request'), facts)).toBeNull();
    expect(check(policy({ blockDeprecated: true }), candidate('request'), facts)?.rule).toBe(
      'deprecated',
    );
  });

  it('blocks a license outside the allowlist and names it', () => {
    const p = policy({ licenses: ['MIT', 'Apache-2.0'] });
    const out = check(p, candidate('x'), { license: 'AGPL-3.0', deprecated: false });
    expect(out?.rule).toBe('license');
    expect(out?.reason).toContain('AGPL-3.0');
  });

  it('enforces the confidence floor', () => {
    const p = policy({ minConfidence: 'emerging' });
    expect(check(p, candidate('x', 'promising'), undefined)?.rule).toBe('confidence');
    expect(check(p, candidate('x', 'emerging'), undefined)).toBeNull();
    expect(check(p, candidate('x', 'proven'), undefined)).toBeNull();
  });

  // The rule this whole layer exists to protect: not knowing something is not
  // evidence against it. A missing license must not read as a license violation,
  // exactly as an unindexed dependency must not read as a clean one.
  it('never convicts on absent facts', () => {
    const p = policy({ licenses: ['MIT'], blockDeprecated: true });
    expect(check(p, candidate('unindexed'), undefined)).toBeNull();
    expect(check(p, candidate('unindexed'), { license: null, deprecated: false })).toBeNull();
  });

  it('prefers the more serious rule when a package trips several', () => {
    const p = policy({
      deny: [{ name: 'x', reason: 'blocked' }],
      blockDeprecated: true,
      licenses: ['MIT'],
    });
    expect(check(p, candidate('x'), { license: 'AGPL-3.0', deprecated: true })?.rule).toBe('denied');
  });
});

describe('applyPolicy', () => {
  it('splits the list and preserves upstream ranking order', () => {
    const p = policy({ deny: [{ name: 'b' }] });
    const { allowed, excluded } = applyPolicy(
      p,
      [candidate('a'), candidate('b'), candidate('c')],
      new Map(),
    );
    expect(allowed.map((c) => c.name)).toEqual(['a', 'c']);
    expect(excluded.map((e) => e.name)).toEqual(['b']);
  });

  it('returns an empty exclusion list rather than omitting it', () => {
    // Silence has to mean "nothing was refused", not "nothing was checked".
    const { allowed, excluded } = applyPolicy(policy({ blockDeprecated: true }), [candidate('a')], new Map());
    expect(allowed).toHaveLength(1);
    expect(excluded).toEqual([]);
  });

  it('can exclude everything, and says so instead of returning an unfiltered list', () => {
    const p = policy({ minConfidence: 'proven' });
    const { allowed, excluded } = applyPolicy(p, [candidate('a', 'unproven')], new Map());
    expect(allowed).toEqual([]);
    expect(excluded).toHaveLength(1);
  });
});
