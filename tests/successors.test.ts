import { describe, it, expect } from 'vitest';
import { buildLearnedSuccessors, lookupSuccessor } from '../src/core/successors';
import { rowToEvaluate } from '../src/mcp/handlers';
import type { PackageRow } from '../src/db/schema';

describe('lookupSuccessor', () => {
  it('maps a superseded package to its replacement', () => {
    expect(lookupSuccessor('moment')).toEqual({
      name: 'dayjs',
      reason: expect.stringContaining('maintenance'),
    });
  });

  it('is case-insensitive', () => {
    expect(lookupSuccessor('TSLint')?.name).toBe('typescript-eslint');
  });

  it('returns null for a healthy package', () => {
    expect(lookupSuccessor('react')).toBeNull();
  });
});

describe('buildLearnedSuccessors', () => {
  const dead = (name: string) => name === 'gulp' || name === 'bower';

  it('learns a successor for a package the index knows is dead', () => {
    const map = buildLearnedSuccessors(
      [{ from: 'gulp', to: 'vite', owners: 5, observations: 9 }],
      dead,
    );
    expect(map.get('gulp')?.name).toBe('vite');
    expect(map.get('gulp')?.reason).toContain('5 teams');
  });

  it('refuses to invent a successor for a healthy package', () => {
    // Three teams switching off React is a preference, not a succession, and
    // publishing it as one would give every agent false authority.
    const map = buildLearnedSuccessors(
      [{ from: 'react', to: 'svelte', owners: 40, observations: 90 }],
      dead,
    );
    expect(map.size).toBe(0);
  });

  it('picks the most widely-agreed successor, not the loudest', () => {
    const map = buildLearnedSuccessors(
      [
        // More observations, but from far fewer accounts — breadth of agreement
        // is the harder thing to manufacture, so it wins.
        { from: 'bower', to: 'noise', owners: 3, observations: 200 },
        { from: 'bower', to: 'npm', owners: 12, observations: 30 },
      ],
      dead,
    );
    expect(map.get('bower')?.name).toBe('npm');
  });

  it('never overrules the hand-verified map', () => {
    const learned = buildLearnedSuccessors(
      [{ from: 'moment', to: 'something-else', owners: 99, observations: 999 }],
      () => true,
    );
    // moment is curated → dayjs. The crowd does not get to move it.
    expect(lookupSuccessor('moment', learned)?.name).toBe('dayjs');
  });

  it('fills a gap the curated map does not cover', () => {
    const learned = buildLearnedSuccessors(
      [{ from: 'gulp', to: 'vite', owners: 5, observations: 9 }],
      dead,
    );
    expect(lookupSuccessor('gulp')).toBeNull();
    expect(lookupSuccessor('gulp', learned)?.name).toBe('vite');
  });
});

describe('rowToEvaluate replacedBy', () => {
  const base = { id: 1, healthScore: 50, deprecated: false, archived: false } as Partial<PackageRow>;

  it('surfaces a successor when the package is superseded', () => {
    const out = rowToEvaluate({ ...base, name: 'request' } as PackageRow);
    expect(out.replacedBy?.name).toBe('got');
  });

  it('is null for a package with no known successor', () => {
    const out = rowToEvaluate({ ...base, name: 'express' } as PackageRow);
    expect(out.replacedBy).toBeNull();
  });
});
