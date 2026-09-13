import { describe, expect, it } from 'vitest';
import { applyPolicy, check, hasRules } from '../src/policy/enforce';
import { parseSelectionPolicy } from '../src/policy/parse';
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
    repoUrl: null, deprecated: false, archived: false, advisories: 0
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
    expect(hasRules(policy({ blockArchived: true }))).toBe(true);
    expect(hasRules(policy({ maxAdvisorySeverity: 'high' }))).toBe(true);
    expect(hasRules(policy({ minWeeklyDownloads: 1000 }))).toBe(true);
    expect(hasRules(policy({ maxStaleMonths: 24 }))).toBe(true);
    expect(hasRules(policy({ maxBundleKb: 50 }))).toBe(true);
    // A zero floor still rules on nothing in practice, but it is a rule someone
    // saved: reading it as absence is how a policy silently stops applying.
    expect(hasRules(policy({ minWeeklyDownloads: 0 }))).toBe(true);
    // `allow` alone is not a rule — it only ever creates exceptions to others.
    expect(hasRules(policy({ allow: [{ name: 'x' }] }))).toBe(false);
  });
});

describe('check', () => {
  it('lets an explicit allow beat every other rule', () => {
    const p = policy({
      allow: [{ name: 'left-pad' }],
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

  it('blocks an archived repo separately from a deprecation notice', () => {
    const facts = { license: 'MIT', deprecated: false, archived: true };
    expect(check(policy({ blockDeprecated: true }), candidate('x'), facts)).toBeNull();
    expect(check(policy({ blockArchived: true }), candidate('x'), facts)?.rule).toBe('archived');
  });

  describe('advisories', () => {
    const vuln = (severity: 'low' | 'moderate' | 'high' | 'critical') => ({
      license: 'MIT',
      deprecated: false,
      advisories: [{ id: 'GHSA-x', severity, summary: 'prototype pollution' }],
    });

    it('blocks strictly above the tolerated severity, never at it', () => {
      const p = policy({ maxAdvisorySeverity: 'moderate' });
      expect(check(p, candidate('x'), vuln('moderate'))).toBeNull();
      expect(check(p, candidate('x'), vuln('low'))).toBeNull();
      expect(check(p, candidate('x'), vuln('high'))?.rule).toBe('advisory');
      expect(check(p, candidate('x'), vuln('critical'))?.rule).toBe('advisory');
    });

    it('rules on the worst advisory, not the first one listed', () => {
      const p = policy({ maxAdvisorySeverity: 'moderate' });
      const facts = {
        license: 'MIT',
        deprecated: false,
        advisories: [
          { id: 'GHSA-a', severity: 'low' as const, summary: 'minor' },
          { id: 'GHSA-b', severity: 'critical' as const, summary: 'rce' },
        ],
      };
      expect(check(p, candidate('x'), facts)?.reason).toContain('GHSA-b');
    });

    it('outranks every judgement rule, so the agent cannot route around it', () => {
      const p = policy({
        maxAdvisorySeverity: 'low',
        blockDeprecated: true,
        maxBundleKb: 1,
        maxStaleMonths: 1,
      });
      const facts = {
        ...vuln('critical'),
        deprecated: true,
        bundleKb: 900,
        monthsSinceRelease: 60,
      };
      expect(check(p, candidate('x'), facts)?.rule).toBe('advisory');
    });
  });

  it('enforces the adoption floor', () => {
    const p = policy({ minWeeklyDownloads: 10_000 });
    const facts = (weeklyDownloads: number) => ({ license: 'MIT', deprecated: false, weeklyDownloads });
    expect(check(p, candidate('x'), facts(9_999))?.rule).toBe('adoption');
    // The floor is inclusive: "at least 10,000" is what the UI says it means.
    expect(check(p, candidate('x'), facts(10_000))).toBeNull();
  });

  it('enforces the staleness ceiling in whole months', () => {
    const p = policy({ maxStaleMonths: 18 });
    const facts = (monthsSinceRelease: number) => ({
      license: 'MIT',
      deprecated: false,
      monthsSinceRelease,
    });
    expect(check(p, candidate('x'), facts(18))).toBeNull();
    expect(check(p, candidate('x'), facts(19))?.rule).toBe('stale');
  });

  it('enforces the bundle ceiling', () => {
    const p = policy({ maxBundleKb: 40 });
    const facts = (bundleKb: number) => ({ license: 'MIT', deprecated: false, bundleKb });
    expect(check(p, candidate('x'), facts(40))).toBeNull();
    expect(check(p, candidate('x'), facts(40.5))?.rule).toBe('size');
  });

  // The rule this whole layer exists to protect: not knowing something is not
  // evidence against it. A missing license must not read as a license violation,
  // exactly as an unindexed dependency must not read as a clean one.
  it('never convicts on absent facts', () => {
    const p = policy({
      licenses: ['MIT'],
      blockDeprecated: true,
      blockArchived: true,
      maxAdvisorySeverity: 'low',
      minWeeklyDownloads: 10_000,
      maxStaleMonths: 6,
      maxBundleKb: 10,
    });
    expect(check(p, candidate('unindexed'), undefined)).toBeNull();
    expect(check(p, candidate('unindexed'), { license: null, deprecated: false })).toBeNull();
    // Explicit nulls are the same claim as a missing key: not established.
    expect(
      check(p, candidate('unindexed'), {
        license: null,
        deprecated: false,
        advisories: null,
        weeklyDownloads: null,
        monthsSinceRelease: null,
        bundleKb: null,
      }),
    ).toBeNull();
    // An empty advisory list is a positive finding — nothing known — not an
    // absent one, and must also clear.
    expect(
      check(p, candidate('clean'), { license: 'MIT', deprecated: false, advisories: [] }),
    ).toBeNull();
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

describe('parseSelectionPolicy', () => {
  const valid = {
    allow: [{ name: 'lodash' }],
    deny: [{ name: 'axios', reason: 'internal client' }],
    minConfidence: 'proven',
    licenses: ['MIT'],
    blockDeprecated: true,
  };

  /** The rules added after the first release, as a client that knows them sends. */
  const laterRules = {
    blockArchived: true,
    maxAdvisorySeverity: 'high' as const,
    minWeeklyDownloads: 5_000,
    maxStaleMonths: 18,
    maxBundleKb: 60,
  };

  it('accepts a complete policy', () => {
    expect(parseSelectionPolicy({ ...valid, ...laterRules })).toEqual({
      mode: 'enforce',
      ...valid,
      ...laterRules,
      minPackageAgeDays: null,
    });
  });

  // `valid` is deliberately the pre-expansion shape. A CLI or an older tab that
  // still posts it must keep saving, and what it saves must be *less*
  // restrictive than it asked for, never more — a client that never heard of the
  // advisory rule must not have one switched on for it.
  it('accepts a policy written before the later rules existed', () => {
    expect(parseSelectionPolicy(valid)).toEqual({
      mode: 'enforce',
      ...valid,
      minPackageAgeDays: null,
      blockArchived: false,
      maxAdvisorySeverity: null,
      minWeeklyDownloads: null,
      maxStaleMonths: null,
      maxBundleKb: null,
    });
  });

  it('rejects an unknown advisory severity rather than dropping the rule', () => {
    expect(parseSelectionPolicy({ ...valid, maxAdvisorySeverity: 'catastrophic' })).toBeNull();
  });

  it('rejects numbers that are not finite, in range, or the right type', () => {
    for (const bad of [NaN, Infinity, -1, '5000', {}]) {
      expect(parseSelectionPolicy({ ...valid, minWeeklyDownloads: bad })).toBeNull();
    }
    // Out of range at either end, rather than clamped: clamping saves a rule
    // other than the one that was sent.
    expect(parseSelectionPolicy({ ...valid, maxStaleMonths: 0 })).toBeNull();
    expect(parseSelectionPolicy({ ...valid, maxStaleMonths: 241 })).toBeNull();
    expect(parseSelectionPolicy({ ...valid, maxBundleKb: 0 })).toBeNull();
  });

  it('keeps a zero adoption floor, which is a rule, not an absent one', () => {
    expect(parseSelectionPolicy({ ...valid, minWeeklyDownloads: 0 })?.minWeeklyDownloads).toBe(0);
  });

  it('rejects rather than repairs a partial object', () => {
    // Merging over the default would let a malformed request silently drop a
    // rule — a denied package quietly becoming installable again.
    const { blockDeprecated: _omitted, ...partial } = valid;
    expect(parseSelectionPolicy(partial)).toBeNull();
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 'policy', 42, []]) {
      expect(parseSelectionPolicy(bad)).toBeNull();
    }
  });

  it('keeps null and [] distinct for licenses', () => {
    expect(parseSelectionPolicy({ ...valid, licenses: null })?.licenses).toBeNull();
    expect(parseSelectionPolicy({ ...valid, licenses: [] })?.licenses).toEqual([]);
  });

  it('treats a missing minConfidence as no rule, not as a failure', () => {
    const { minConfidence: _omitted, ...rest } = valid;
    expect(parseSelectionPolicy(rest)?.minConfidence).toBeNull();
  });

  it('rejects an unknown confidence level', () => {
    expect(parseSelectionPolicy({ ...valid, minConfidence: 'excellent' })).toBeNull();
  });

  it('trims names and drops an empty reason rather than storing one', () => {
    const out = parseSelectionPolicy({
      ...valid,
      allow: [{ name: '  lodash  ' }],
      deny: [{ name: 'axios', reason: '   ' }],
    });
    expect(out?.allow).toEqual([{ name: 'lodash' }]);
    expect(out?.deny).toEqual([{ name: 'axios' }]);
  });

  it('rejects blank and oversized names', () => {
    expect(parseSelectionPolicy({ ...valid, allow: [{ name: '   ' }] })).toBeNull();
    expect(parseSelectionPolicy({ ...valid, allow: ['a'.repeat(215)] })).toBeNull();
  });

  it('rejects malformed deny entries', () => {
    expect(parseSelectionPolicy({ ...valid, deny: ['axios'] })).toBeNull();
    expect(parseSelectionPolicy({ ...valid, deny: [{ reason: 'no name' }] })).toBeNull();
    expect(parseSelectionPolicy({ ...valid, deny: [{ name: 'a', reason: 1 }] })).toBeNull();
  });

  it('bounds list length', () => {
    const huge = Array.from({ length: 501 }, (_, i) => `pkg-${i}`);
    expect(parseSelectionPolicy({ ...valid, allow: huge })).toBeNull();
  });

  it('round-trips through the rule engine', () => {
    const parsed = parseSelectionPolicy(valid);
    expect(parsed && hasRules(parsed)).toBe(true);
  });
});
