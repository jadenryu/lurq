import { describe, it, expect } from 'vitest';
import { hopPairs, planHops, tooFarToSequence, MAX_HOPS } from '../src/github/hops';

/** Releases across majors 6–8, plus a prerelease that must never be routed through. */
const VERSIONS = [
  '6.4.0',
  '6.9.2',
  '7.0.0',
  '7.4.1',
  '8.0.0-beta.1',
  '8.0.0',
  '8.1.0',
];

describe('planHops', () => {
  it('routes a two-major upgrade through the highest release of the middle major', () => {
    expect(planHops(VERSIONS, '6.9.2', '8.1.0')).toEqual(['6.9.2', '7.4.1', '8.1.0']);
  });

  it('plans nothing for a single-major bump — the direct diff is already the hop', () => {
    expect(planHops(VERSIONS, '7.4.1', '8.1.0')).toEqual([]);
  });

  it('plans nothing within one major', () => {
    expect(planHops(VERSIONS, '6.4.0', '6.9.2')).toEqual([]);
  });

  it('never routes a migration through a prerelease', () => {
    // 8.0.0-beta.1 is higher than nothing anyone shipped; sending a team through
    // it would be actively misleading.
    const path = planHops([...VERSIONS, '7.5.0-rc.1'], '6.9.2', '8.1.0');
    expect(path.some((v) => v.includes('-'))).toBe(false);
  });

  it('skips a major with no known release rather than inventing one', () => {
    // 7.x missing from the timeline: the path still connects 6 → 9 through 8.
    const sparse = ['6.9.2', '8.2.0', '9.0.0'];
    expect(planHops(sparse, '6.9.2', '9.0.0')).toEqual(['6.9.2', '8.2.0', '9.0.0']);
  });

  it('refuses to plan a path longer than the cap', () => {
    const wide = Array.from({ length: 12 }, (_, i) => `${i + 1}.0.0`);
    expect(planHops(wide, '1.0.0', '12.0.0')).toEqual([]);
  });

  it('returns nothing for a downgrade or an invalid version', () => {
    expect(planHops(VERSIONS, '8.1.0', '6.9.2')).toEqual([]);
    expect(planHops(VERSIONS, 'latest', '8.1.0')).toEqual([]);
  });
});

describe('hopPairs', () => {
  it('yields consecutive pairs', () => {
    expect(hopPairs(['6.9.2', '7.4.1', '8.1.0'])).toEqual([
      { fromVersion: '6.9.2', toVersion: '7.4.1' },
      { fromVersion: '7.4.1', toVersion: '8.1.0' },
    ]);
  });

  it('yields nothing for an unplanned path', () => {
    expect(hopPairs([])).toEqual([]);
  });
});

describe('tooFarToSequence', () => {
  it('flags an upgrade beyond the hop cap', () => {
    expect(tooFarToSequence('1.0.0', `${MAX_HOPS + 2}.0.0`)).toBe(true);
  });

  it('does not flag one inside it', () => {
    expect(tooFarToSequence('6.9.2', '8.1.0')).toBe(false);
  });
});
