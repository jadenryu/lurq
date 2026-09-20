/**
 * Policy scope, applied once.
 *
 * `lurq fix` with no arguments derives its own plan, and the `--plan` file path
 * reads one off disk. Both must decide "may the agent attempt this upgrade?"
 * identically — the interesting case being a plan with no `inScope` key at all,
 * which predates scope enforcement and must behave as it did before.
 */
import { describe, expect, it } from 'vitest';
import { targetsFromUpgrades } from '../src/cli/checkUpgrade';

const up = (over: Partial<Parameters<typeof targetsFromUpgrades>[0][number]> = {}) => ({
  package: 'cookie',
  fromVersion: '1.1.1',
  toVersion: '2.0.1',
  ...over,
});

describe('targetsFromUpgrades', () => {
  it('keeps an upgrade the policy allows', () => {
    expect(targetsFromUpgrades([up({ inScope: true })])).toEqual([
      { package: 'cookie', fromVersion: '1.1.1', toVersion: '2.0.1' },
    ]);
  });

  it('drops one the policy holds', () => {
    expect(targetsFromUpgrades([up({ inScope: false })])).toEqual([]);
  });

  it('keeps one with no scope annotation, because absent policy is ungoverned and not excluded', () => {
    // Getting this backwards empties the brief against every older server.
    expect(targetsFromUpgrades([up()])).toHaveLength(1);
  });

  it('drops entries missing a version, which cannot be diffed', () => {
    expect(
      targetsFromUpgrades([up({ fromVersion: '' }), up({ toVersion: '' }), up({ package: '' })]),
    ).toEqual([]);
  });

  it('carries only the three fields a target needs, so plan extras cannot leak into a diff', () => {
    const [target] = targetsFromUpgrades([up({ inScope: true, scopeReason: 'held' } as never)]);
    expect(Object.keys(target!).sort()).toEqual(['fromVersion', 'package', 'toVersion']);
  });
});
