import { describe, it, expect } from 'vitest';
import { bestSatisfying, declaredDeps, depDrift, rangeFloor } from '../src/github/drift';
import type { RepoManifest } from '../src/github/types';

/**
 * Ranges npm accepts that `semver` throws on. Each of these appeared in a real
 * package.json and each one used to discard the whole repo's scan.
 */
const NON_SEMVER = [
  'latest',
  'next',
  'workspace:*',
  'workspace:^',
  'catalog:',
  'file:../local-pkg',
  'link:../sibling',
  'github:owner/repo',
  'git+https://github.com/owner/repo.git',
  'npm:other-package@^1.0.0',
];

/** Odd but genuinely valid semver ranges, all of which mean `*`. These must keep
 *  resolving rather than being swept up by an over-broad guard. */
const VALID_BUT_ODD = ['', '*', '*.x.x', 'x'];

describe('rangeFloor / bestSatisfying (repo scans survive real package.json)', () => {
  it('returns null instead of throwing on every non-semver range npm allows', () => {
    for (const range of NON_SEMVER) {
      expect(() => rangeFloor(range), range).not.toThrow();
      expect(rangeFloor(range), range).toBeNull();
      expect(() => bestSatisfying(['1.0.0', '2.0.0'], range), range).not.toThrow();
    }
  });
  it('still resolves ordinary semver ranges', () => {
    expect(rangeFloor('^1.2.3')).toBe('1.2.3');
    expect(rangeFloor('>=2.0.0 <3')).toBe('2.0.0');
    expect(bestSatisfying(['1.0.0', '1.5.0', '2.0.0'], '^1.0.0')).toBe('1.5.0');
  });
  it('does not sweep up valid-but-odd ranges — they still resolve', () => {
    for (const range of VALID_BUT_ODD) {
      expect(rangeFloor(range), range).not.toBeNull();
      expect(bestSatisfying(['1.0.0', '2.0.0'], range), range).toBe('2.0.0');
    }
  });
});

describe('declaredDeps', () => {
  it('does not throw when a workspace declares a dist-tag range', () => {
    const manifests: RepoManifest[] = [
      { path: 'package.json', deps: { react: '^18.0.0' } },
      { path: 'apps/web/package.json', deps: { react: 'latest', zod: 'workspace:*' } },
    ];
    expect(() => declaredDeps(manifests)).not.toThrow();
    const out = declaredDeps(manifests);
    // Both packages survive as real dependencies...
    expect(out.has('react')).toBe(true);
    expect(out.has('zod')).toBe(true);
    // ...and the comparable range still wins the "lowest declared" contest.
    expect(out.get('react')?.range).toBe('^18.0.0');
    expect(out.get('react')?.declaredIn).toHaveLength(2);
  });
});

describe('depDrift', () => {
  const indexed = { latestVersion: '3.0.0', deprecated: false, advisories: 0 };
  it('reports no computable drift for an uncomparable range, without throwing', () => {
    const d = depDrift('x', { range: 'latest', declaredIn: [] }, indexed, ['1.0.0', '3.0.0']);
    expect(d.resolved).toBeNull();
    expect(d.majorsBehind).toBe(0);
  });
  it('still computes drift normally for a semver range', () => {
    const d = depDrift('x', { range: '^1.0.0', declaredIn: [] }, indexed, ['1.0.0', '3.0.0']);
    expect(d.resolved).toBe('1.0.0');
    expect(d.majorsBehind).toBe(2);
  });
});
