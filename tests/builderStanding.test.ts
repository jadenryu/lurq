/**
 * Pinned: percentiles rank by direction, dependency metrics are shares, ties
 * count half, only builders with a stack are compared on stack metrics, and
 * nothing is ranked below the minimum population.
 */
import { describe, expect, it } from 'vitest';
import type { BuilderProfile } from '../src/github/builderProfile';
import { builderMetrics, standing, type BuilderMetrics, type BuilderStanding, type StandingMetricId } from '../src/github/builderStanding';

const m = (over: Partial<BuilderMetrics> = {}): BuilderMetrics => ({
  repos: 10,
  active90: 2,
  stars: 5,
  depsTracked: 100,
  depsBehind: 20,
  depsMajor: 5,
  advisories: 1,
  ...over,
});
const field = (n: number, over: (i: number) => Partial<BuilderMetrics>) => Array.from({ length: n }, (_, i) => m(over(i)));
const rank = (s: BuilderStanding, id: StandingMetricId) => s.metrics.find((x) => x.id === id);
const noStack = { depsTracked: 0, depsBehind: 0, depsMajor: 0, advisories: 0 };

describe('standing', () => {
  it('ranks a higher-is-better metric by the builders below it', () => {
    // repos 0..19; 15 is above 15 of them and tied with one: (15 + 0.5) / 20.
    const s = standing(m({ repos: 15 }), field(20, (i) => ({ repos: i })));
    expect(rank(s, 'repos')).toMatchObject({ value: 15, percentile: 78, population: 20, better: 'higher' });
  });

  it('ranks dependency metrics as shares, lower is better', () => {
    // More majors behind in absolute terms (10 vs 5), but 5% of the stack against 10%.
    const s = standing(m({ depsTracked: 200, depsMajor: 10 }), field(20, () => ({ depsTracked: 50, depsMajor: 5 })));
    expect(rank(s, 'majorShare')).toMatchObject({ value: 0.05, percentile: 100, better: 'lower' });
  });

  it('counts ties as half, so a common zero is not ahead of everyone', () => {
    // 10 builders with advisories (worse), 10 with none (tied): (10 + 5) / 20.
    const s = standing(m({ advisories: 0 }), field(20, (i) => ({ advisories: i < 10 ? 0 : 3 })));
    expect(rank(s, 'advisoryRate')?.percentile).toBe(75);
  });

  it('compares stack metrics only among builders with a stack, and skips them for a subject without one', () => {
    const others = [...field(20, () => ({})), ...field(5, () => noStack)];
    expect(rank(standing(m(), others), 'behindShare')?.population).toBe(20);
    expect(rank(standing(m(), others), 'repos')?.population).toBe(25);
    expect(rank(standing(m(noStack), others), 'behindShare')).toBeUndefined();
  });

  it('ranks nothing against fewer builders than the minimum', () => {
    expect(standing(m(), field(19, () => ({})))).toEqual({ population: 19, minimum: 20, metrics: [] });
  });
});

describe('builderMetrics', () => {
  it('sums the stacks and copies the GitHub stats', () => {
    const profile = {
      stats: { repos: 12, active90: 4, stars: 90, languages: [] },
      repos: [
        { depsTracked: 30, anyDrift: 6, majorDrift: 2, advisories: 1 },
        { depsTracked: 10, anyDrift: 1, majorDrift: 0, advisories: 0 },
      ],
    } as unknown as BuilderProfile;
    expect(builderMetrics(profile)).toEqual({
      repos: 12,
      active90: 4,
      stars: 90,
      depsTracked: 40,
      depsBehind: 7,
      depsMajor: 2,
      advisories: 1,
    });
  });
});
