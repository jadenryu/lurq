/**
 * The archetype is the first thing a visitor reads about themselves, and every
 * way it goes wrong is quiet: a null trait that wins, or a five-dependency toy
 * crowned the steward over someone with a real stack.
 */
import { describe, expect, it } from 'vitest';
import { pickArchetype, scoreTraits, type GhRepo } from '../src/github/builderProfile';
import type { PublicScan } from '../src/github/publicScan';

const NOW = Date.parse('2026-09-01T00:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function repo(over: Partial<GhRepo> = {}): GhRepo {
  return {
    name: 'r',
    owner: { login: 'someone' },
    fork: false,
    archived: false,
    language: 'TypeScript',
    stargazers_count: 0,
    created_at: ago(30),
    pushed_at: ago(1),
    ...over,
  };
}

function stack(tracked: number, over: Partial<PublicScan> = {}): PublicScan {
  return {
    repo: 'someone/r',
    url: 'https://github.com/someone/r',
    depsDeclared: tracked,
    depsTracked: tracked,
    majorDrift: 0,
    anyDrift: 0,
    deprecated: 0,
    advisories: 0,
    conflicts: 0,
    deps: [],
    conflictDetail: [],
    partial: true,
    ...over,
  };
}

const score = (traits: ReturnType<typeof scoreTraits>, id: string) =>
  traits.find((t) => t.id === id)!.score;

describe('scoreTraits', () => {
  it('reads a burst of new, recently pushed repos as a shipper', () => {
    const repos = Array.from({ length: 8 }, (_, i) => repo({ name: `r${i}` }));
    expect(pickArchetype(scoreTraits(repos, [], NOW))).toBe('shipper');
  });

  it('reads long-lived, starred work as an architect', () => {
    const repos = [
      repo({ name: 'a', created_at: ago(1500), pushed_at: ago(20), stargazers_count: 5000 }),
      repo({ name: 'b', created_at: ago(1200), pushed_at: ago(200) }),
    ];
    expect(pickArchetype(scoreTraits(repos, [], NOW))).toBe('architect');
  });

  it('does not count an old repo nobody pushes as architecture', () => {
    const repos = [repo({ created_at: ago(2000), pushed_at: ago(800) })];
    expect(score(scoreTraits(repos, [], NOW), 'architect')).toBe(0);
  });

  it('makes stewardship something a real, current stack earns', () => {
    const repos = [repo()];
    const toy = score(scoreTraits(repos, [stack(5)], NOW), 'steward')!;
    const real = score(scoreTraits(repos, [stack(40)], NOW), 'steward')!;
    const risky = score(scoreTraits(repos, [stack(40, { advisories: 6 })], NOW), 'steward')!;
    expect(real).toBeGreaterThan(toy);
    expect(risky).toBeLessThan(real);
  });

  it('leaves stewardship unscored with nothing to measure, and never picks it', () => {
    const traits = scoreTraits([], [], NOW);
    expect(score(traits, 'steward')).toBeNull();
    expect(pickArchetype(traits)).not.toBe('steward');
  });

  it('ignores forks for every trait', () => {
    const forks = Array.from({ length: 20 }, (_, i) =>
      repo({ name: `f${i}`, fork: true, language: `L${i}` }),
    );
    const traits = scoreTraits(forks, [], NOW);
    expect(traits.map((t) => t.score)).toEqual([0, 0, 0, null]);
  });
});
