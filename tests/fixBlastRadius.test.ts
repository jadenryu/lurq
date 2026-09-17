/**
 * What `lurq fix` may perform, as opposed to what `check-upgrade` reports on.
 *
 * Checking an upgrade is free; performing one edits the tree. The upgrade
 * workflow already states these rules for the agent it drives — take at most N,
 * walk multi-major upgrades a step at a time, treat an unplannable sequence as
 * a migration — and a rule doing the same job has to obey them, or wiring the
 * deterministic fixer into that workflow would quietly remove its blast-radius
 * cap.
 */
import { describe, expect, it } from 'vitest';
import { fixableTargets, targetsFromUpgrades, type PlanUpgrade } from '../src/cli/checkUpgrade';

const up = (over: Partial<PlanUpgrade> = {}): PlanUpgrade => ({
  package: 'cookie',
  fromVersion: '1.1.1',
  toVersion: '2.0.1',
  ...over,
});

const names = (list: { package: string }[]) => list.map((x) => x.package);

describe('what it will attempt', () => {
  it('takes an ordinary single-major upgrade', () => {
    const { targets, skipped } = fixableTargets([up()]);
    expect(targets).toEqual([{ package: 'cookie', fromVersion: '1.1.1', toVersion: '2.0.1' }]);
    expect(skipped).toEqual([]);
  });

  it('treats an absent hops array as one hop, not as unknown', () => {
    expect(fixableTargets([up({ hops: [] })]).targets).toHaveLength(1);
    expect(fixableTargets([up()]).targets).toHaveLength(1);
  });
});

describe('what it refuses to attempt', () => {
  it('will not jump a multi-major upgrade that must be walked in steps', () => {
    const { targets, skipped } = fixableTargets([up({ hops: [{}, {}] })]);
    expect(targets).toEqual([]);
    expect(skipped[0]!.reason).toMatch(/crosses 2 majors/);
  });

  it('will not attempt an upgrade whose sequence could not be planned', () => {
    const { skipped } = fixableTargets([up({ sequenceNote: 'no path from 1 to 4' })]);
    expect(skipped[0]!.reason).toMatch(/a migration, not an upgrade/);
  });

  it('honours the repo policy, exactly as the plan-file path does', () => {
    expect(fixableTargets([up({ inScope: false })]).targets).toEqual([]);
    // Absent policy is ungoverned, never excluded — the same rule as elsewhere.
    expect(fixableTargets([up({ inScope: undefined })]).targets).toHaveLength(1);
  });

  it('drops an entry missing a version rather than reporting a skip nobody can act on', () => {
    const { targets, skipped } = fixableTargets([up({ toVersion: '' })]);
    expect(targets).toEqual([]);
    expect(skipped).toEqual([]);
  });
});

describe('the blast radius', () => {
  const four = [up({ package: 'a' }), up({ package: 'b' }), up({ package: 'c' }), up({ package: 'd' })];

  it('stops at the cap and names what it did not reach', () => {
    const { targets, skipped } = fixableTargets(four, 2);
    expect(names(targets)).toEqual(['a', 'b']);
    expect(names(skipped)).toEqual(['c', 'd']);
    expect(skipped[0]!.reason).toMatch(/beyond the --max 2 cap/);
  });

  it('is uncapped when no cap is given', () => {
    expect(fixableTargets(four).targets).toHaveLength(4);
  });

  it('does not spend the cap on upgrades it was never going to attempt', () => {
    // The refused one must not count against the two the user allowed.
    const { targets } = fixableTargets([up({ package: 'skipme', hops: [{}, {}] }), ...four], 2);
    expect(names(targets)).toEqual(['a', 'b']);
  });
});

describe('check-upgrade is deliberately not narrowed', () => {
  it('still reports on a multi-major upgrade that fix will not touch', () => {
    // Checking is free and tells the user something; only fixing is capped.
    const entries = [up({ hops: [{}, {}] }), up({ package: 'zod', sequenceNote: 'unplannable' })];
    expect(targetsFromUpgrades(entries)).toHaveLength(2);
    expect(fixableTargets(entries).targets).toHaveLength(0);
  });
});
