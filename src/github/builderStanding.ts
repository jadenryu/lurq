/**
 * Where a builder stands among everyone else lurq has a saved scan of.
 *
 * Pure: the population is passed in, so the ranking is testable without a
 * database and the same code answers for a fresh save and a reopened one.
 *
 * Three choices make a percentile here mean something:
 *
 * - DEPENDENCY METRICS ARE SHARES. Raw "majors behind" mostly measures how big
 *   a stack is: 10 of 200 is healthier than 5 of 50. Behind, a major behind and
 *   advisories are ranked per tracked dependency, and only among builders who
 *   have a tracked stack at all.
 * - TIES COUNT HALF (the midrank). Most builders have zero advisories; without
 *   this, every one of them would be "ahead of 100%", which is ahead of nobody.
 * - NOTHING UNDER A MINIMUM. A metric is only ranked against at least
 *   MIN_POPULATION other builders. "Top 10% of four people" is noise.
 */
import type { BuilderProfile } from './builderProfile';

/** The counts ranked on. Stored as columns on `builder_scans`. */
export interface BuilderMetrics {
  repos: number;
  active90: number;
  stars: number;
  depsTracked: number;
  depsBehind: number;
  depsMajor: number;
  advisories: number;
}

export type StandingMetricId = 'repos' | 'active90' | 'stars' | 'behindShare' | 'majorShare' | 'advisoryRate';

export interface StandingMetric {
  id: StandingMetricId;
  better: 'higher' | 'lower';
  /** The subject's own value: a count, a 0–1 share, or advisories per 100 deps. */
  value: number;
  /** 0–100: the share of the compared builders this one is ahead of, ties counting half. */
  percentile: number;
  /** How many builders this metric was ranked against. */
  population: number;
}

export interface BuilderStanding {
  /** Other builders with a saved scan, the subject excluded. */
  population: number;
  minimum: number;
  /** Only the metrics with enough builders to rank against. Empty is "not enough scans yet". */
  metrics: StandingMetric[];
}

export const MIN_POPULATION = 20;

/**
 * Stack counts are summed over the repos read, the way the stack health trait
 * sums them. `anyDrift` includes `majorDrift`, so behind ≥ a major behind.
 */
export function builderMetrics(profile: BuilderProfile): BuilderMetrics {
  const sum = (pick: (s: BuilderProfile['repos'][number]) => number) =>
    profile.repos.reduce((n, s) => n + pick(s), 0);
  return {
    repos: profile.stats.repos,
    active90: profile.stats.active90,
    stars: profile.stats.stars,
    depsTracked: sum((s) => s.depsTracked),
    depsBehind: sum((s) => s.anyDrift),
    depsMajor: sum((s) => s.majorDrift),
    advisories: sum((s) => s.advisories),
  };
}

const share = (part: number, whole: number) => (whole > 0 ? Math.min(1, part / whole) : null);

const METRICS: { id: StandingMetricId; better: 'higher' | 'lower'; read: (m: BuilderMetrics) => number | null }[] = [
  { id: 'repos', better: 'higher', read: (m) => m.repos },
  { id: 'active90', better: 'higher', read: (m) => m.active90 },
  { id: 'stars', better: 'higher', read: (m) => m.stars },
  { id: 'behindShare', better: 'lower', read: (m) => share(m.depsBehind, m.depsTracked) },
  { id: 'majorShare', better: 'lower', read: (m) => share(m.depsMajor, m.depsTracked) },
  { id: 'advisoryRate', better: 'lower', read: (m) => (m.depsTracked > 0 ? (100 * m.advisories) / m.depsTracked : null) },
];

/** Rank `subject` against `others`, which must not include the subject itself. */
export function standing(subject: BuilderMetrics, others: BuilderMetrics[], minimum = MIN_POPULATION): BuilderStanding {
  const metrics: StandingMetric[] = [];
  for (const def of METRICS) {
    const value = def.read(subject);
    if (value === null) continue;
    const field = others.map(def.read).filter((v): v is number => v !== null);
    if (field.length < minimum) continue;

    let ahead = 0;
    let tied = 0;
    for (const v of field) {
      if (v === value) tied++;
      else if (def.better === 'higher' ? v < value : v > value) ahead++;
    }
    metrics.push({
      id: def.id,
      better: def.better,
      value,
      percentile: Math.round((100 * (ahead + tied / 2)) / field.length),
      population: field.length,
    });
  }
  return { population: others.length, minimum, metrics };
}
