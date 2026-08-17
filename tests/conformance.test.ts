import { describe, expect, it } from 'vitest';
import { ruleRepo, type RuleFacts } from '../src/policy/conformance';
import { DEFAULT_SELECTION_POLICY, type SelectionPolicy } from '../src/policy/types';

const policy = (over: Partial<SelectionPolicy>): SelectionPolicy => ({
  ...DEFAULT_SELECTION_POLICY,
  ...over,
});

const facts = (entries: Record<string, Partial<RuleFacts>>): Map<string, RuleFacts> =>
  new Map(
    Object.entries(entries).map(([name, f]) => [
      name,
      { license: null, deprecated: false, confidence: null, ...f },
    ]),
  );

describe('ruleRepo', () => {
  it('reports a denied dependency the repo already has', () => {
    const result = ruleRepo(
      policy({ deny: [{ name: 'axios', reason: 'use the internal client' }] }),
      ['axios', 'zod'],
      facts({ axios: {}, zod: {} }),
    );
    expect(result.total).toBe(1);
    expect(result.violations[0]).toMatchObject({ name: 'axios', rule: 'denied' });
    expect(result.checked).toBe(2);
  });

  it('lets an explicit allow beat a rule the package would otherwise fail', () => {
    const result = ruleRepo(
      policy({ allow: ['moment'], blockDeprecated: true }),
      ['moment'],
      facts({ moment: { deprecated: true } }),
    );
    expect(result.total).toBe(0);
  });

  it('never counts an unindexed dependency as passing', () => {
    const result = ruleRepo(policy({ blockDeprecated: true }), ['left-pad'], facts({}));
    expect(result).toMatchObject({ checked: 0, unchecked: 1, total: 0 });
  });

  it('abstains from the confidence floor when the package has no grade', () => {
    const result = ruleRepo(
      policy({ minConfidence: 'proven' }),
      ['ungraded'],
      facts({ ungraded: { confidence: null } }),
    );
    // Not a violation — "we never scored it" is not evidence that it is weak.
    expect(result.total).toBe(0);
    // But the abstention is visible, so the repo can't look like it cleared a
    // bar nothing was measured against.
    expect(result.unscored).toBe(1);
  });

  it('still applies licence and deprecation rules to an ungraded package', () => {
    const result = ruleRepo(
      policy({ minConfidence: 'proven', blockDeprecated: true }),
      ['ungraded'],
      facts({ ungraded: { confidence: null, deprecated: true } }),
    );
    expect(result.violations[0]).toMatchObject({ rule: 'deprecated' });
  });

  it('does not count abstentions when no confidence floor is set', () => {
    const result = ruleRepo(policy({ blockDeprecated: true }), ['x'], facts({ x: {} }));
    expect(result.unscored).toBe(0);
  });

  it('enforces the confidence floor when the grade is known', () => {
    const result = ruleRepo(
      policy({ minConfidence: 'proven' }),
      ['risky'],
      facts({ risky: { confidence: 'unproven' } }),
    );
    expect(result.violations[0]).toMatchObject({ rule: 'confidence' });
  });

  it('caps the violation list but never the count', () => {
    const names = Array.from({ length: 80 }, (_, i) => `pkg-${i}`);
    const result = ruleRepo(
      policy({ deny: names.map((name) => ({ name })) }),
      names,
      facts(Object.fromEntries(names.map((n) => [n, {}]))),
    );
    expect(result.total).toBe(80);
    expect(result.violations).toHaveLength(50);
  });
});
