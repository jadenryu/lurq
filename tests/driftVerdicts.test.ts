import { describe, expect, it } from 'vitest';
import { breaksSomething } from '../src/github/scope';
import type { UpgradeVerdict } from '../src/github/types';

/**
 * The predicate the scan counts with and the scope acts on is now one function.
 * If these disagree, the dashboard reports a number the autopilot does not use,
 * which is the exact bug this work exists to close.
 */
describe('breaksSomething', () => {
  it('is true only where the surface diff found real breakage', () => {
    expect(breaksSomething({ verdict: 'removes-exports' })).toBe(true);
    expect(breaksSomething({ verdict: 'arity-changed' })).toBe(true);
    expect(breaksSomething({ verdict: 'clean' })).toBe(false);
  });

  it('does not count an unextracted surface as breaking', () => {
    // `unknown` means nobody looked. Counting it would inflate every fresh
    // repo's breaking count on its first scan, before extraction has caught up,
    // and teach the reader that the number is noise.
    expect(breaksSomething({ verdict: 'unknown' })).toBe(false);
  });

  it('covers every verdict the type allows', () => {
    // A new verdict added to the union without a decision here would silently
    // count as "does not break".
    const all: UpgradeVerdict[] = ['removes-exports', 'arity-changed', 'clean', 'unknown'];
    expect(all.filter((verdict) => breaksSomething({ verdict }))).toEqual([
      'removes-exports',
      'arity-changed',
    ]);
  });
});
