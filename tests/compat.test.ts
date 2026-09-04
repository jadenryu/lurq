import { describe, it, expect } from 'vitest';
import { canonicalPair, compatSetKey } from '../src/db/compat';
import { edgeMatchesVersions, enumeratePairs, gradeOverall } from '../src/compat/check';
import { stackKey } from '../src/db/stackResolutions';
import { summarizeEresolve } from '../src/pipeline/resolveCheck';

const m = (name: string, version: string) => ({ name, version });
import { deriveCompatEdges, pairKey } from '../src/pipeline/compat';
import type { SandboxSetResult } from '../src/sandbox/types';

describe('compatSetKey (self-heal dedup)', () => {
  it('is order-independent and dedups names, so one set enqueues once', () => {
    expect(compatSetKey(['react', 'lodash'])).toBe(compatSetKey(['lodash', 'react']));
    expect(compatSetKey(['a', 'b', 'a'])).toBe('a|b');
  });
});

describe('gradeOverall (set-level verdict, no `likely`)', () => {
  const base = { hasConflict: false, hasUnverifiedMember: false } as const;
  it('proven conflict wins over everything', () => {
    expect(
      gradeOverall({ ...base, hasConflict: true, hasUnverifiedMember: true, resolution: 'resolved' }),
    ).toBe('conflict');
  });
  it("npm's ERESOLVE is a conflict even with nothing declared", () => {
    expect(gradeOverall({ ...base, resolution: 'conflict' })).toBe('conflict');
  });
  it('an un-ingested member is unknown', () => {
    expect(
      gradeOverall({ ...base, hasUnverifiedMember: true, resolution: 'resolved' }),
    ).toBe('unknown');
  });
  it('an inconclusive resolve is unknown, never a hedge', () => {
    expect(gradeOverall({ ...base, resolution: 'inconclusive' })).toBe('unknown');
  });
  it('a set npm resolved is compatible', () => {
    expect(gradeOverall({ ...base, resolution: 'resolved' })).toBe('compatible');
  });
  it('never returns the retired `likely` verdict', () => {
    const verdicts = (['resolved', 'conflict', 'inconclusive'] as const).flatMap((resolution) =>
      [true, false].flatMap((hasConflict) =>
        [true, false].map((hasUnverifiedMember) =>
          gradeOverall({ hasConflict, hasUnverifiedMember, resolution }),
        ),
      ),
    );
    expect(verdicts).not.toContain('likely');
  });
});

describe('stackKey (the cache key is the set AND its versions)', () => {
  it('is order-independent, so the same stack asked two ways hits once', () => {
    expect(stackKey([m('react', '19.0.0'), m('next', '16.0.1')])).toBe(
      stackKey([m('next', '16.0.1'), m('react', '19.0.0')]),
    );
  });
  it('separates versions, so react@18 never answers for react@19', () => {
    expect(stackKey([m('react', '18.3.1')])).not.toBe(stackKey([m('react', '19.0.0')]));
  });
});

describe('summarizeEresolve', () => {
  it('keeps the lines naming the clash and drops npm\'s --force advice', () => {
    const out = summarizeEresolve(
      [
        'npm error code ERESOLVE',
        'npm error While resolving: my-app@1.0.0',
        'npm error Found: react@19.2.8',
        'npm error Could not resolve dependency:',
        'npm error peer react@"^18.0.0" from next@14.1.3',
        'npm error Fix the upstream dependency conflict, or retry',
        'npm error this command with --force or --legacy-peer-deps',
      ].join('\n'),
    );
    expect(out).toContain('Found: react@19.2.8');
    expect(out).toContain('peer react@"^18.0.0" from next@14.1.3');
    expect(out).not.toContain('--legacy-peer-deps');
  });
  it('always says something, even on output it cannot parse', () => {
    expect(summarizeEresolve('ERESOLVE something unfamiliar')).toBeTruthy();
  });
  it('caps length, because this is stored and returned over the wire', () => {
    const long = Array.from({ length: 200 }, (_, i) => `npm error Found: pkg-${i}@1.0.0`).join('\n');
    expect(summarizeEresolve(long).length).toBeLessThanOrEqual(600);
  });
});

function result(over: Partial<SandboxSetResult>): SandboxSetResult {
  return {
    driver: 'local',
    moduleSystem: 'cjs',
    installed: true,
    loaded: [],
    durationMs: 1,
    error: null,
    ...over,
  };
}

describe('canonicalPair', () => {
  it('orders by package name regardless of input order', () => {
    const a = canonicalPair({ name: 'react', version: '19' }, { name: 'axios', version: '1' });
    const b = canonicalPair({ name: 'axios', version: '1' }, { name: 'react', version: '19' });
    expect(a).toEqual(b);
    expect(a.packageA).toBe('axios');
    expect(a.packageB).toBe('react');
  });
});

describe('deriveCompatEdges', () => {
  const resolved = [
    { name: 'react', version: '19.0.0' },
    { name: 'react-dom', version: '19.0.0' },
    { name: 'zod', version: '3.0.0' },
  ];
  const allLoaded = (rs: typeof resolved) => rs.map((r) => ({ name: r.name, loaded: true }));
  const noneLoaded = (rs: typeof resolved) =>
    rs.map((r) => ({ name: r.name, loaded: null as boolean | null }));

  it('marks every pair compatible when the set co-installs and all load', () => {
    const edges = deriveCompatEdges(
      resolved,
      result({ installed: true, loaded: allLoaded(resolved) }),
    );
    expect(edges).toHaveLength(3); // 3 choose 2
    expect(edges.every((e) => e.status === 'compatible')).toBe(true);
  });

  it('marks a failed PAIR as a conflict (precise attribution)', () => {
    const pair = resolved.slice(0, 2);
    const edges = deriveCompatEdges(
      pair,
      result({ installed: false, loaded: noneLoaded(pair) }),
    );
    expect(edges).toEqual([
      expect.objectContaining({ a: 'react', b: 'react-dom', status: 'conflict' }),
    ]);
  });

  it('asserts no edge for a larger failed set (cannot attribute the conflict)', () => {
    const edges = deriveCompatEdges(
      resolved,
      result({ installed: false, loaded: noneLoaded(resolved) }),
    );
    expect(edges).toEqual([]);
  });

  it('does not assert compatibility when a member fails to load', () => {
    const edges = deriveCompatEdges(
      resolved,
      result({
        installed: true,
        loaded: [
          { name: 'react', loaded: true },
          { name: 'react-dom', loaded: true },
          { name: 'zod', loaded: false },
        ],
      }),
    );
    expect(edges).toEqual([]);
  });
});

describe('enumeratePairs (a verdict belongs to a pair, not a package)', () => {
  const names = ['next', '@auth/core', 'next-auth', 'typescript'];

  it('emits exactly n(n-1)/2 pairs, every one graded', () => {
    const pairs = enumeratePairs(names, []);
    expect(pairs).toHaveLength((names.length * (names.length - 1)) / 2);
    expect(pairs.every((p) => p.status === 'held')).toBe(true);
  });

  it('grades only the pair a conflict names, leaving its members ungraded', () => {
    const pairs = enumeratePairs(names, [
      {
        source: 'peer-deps',
        packages: ['next-auth', '@auth/core'],
        detail: 'next-auth needs peer @auth/core@0.34.3, but the stack uses @auth/core@0.41.3',
        requirement: { peer: '@auth/core', range: '0.34.3', resolved: '0.41.3' },
      },
    ]);
    const conflicted = pairs.filter((p) => p.status === 'conflict');
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0]!.requirement?.resolved).toBe('0.41.3');
    // @auth/core is in a conflicting pair, but its pair with `next` still holds —
    // which is the whole reason verdicts can't live on packages.
    const withNext = pairs.find(
      (p) => pairKey(p.a, p.b) === pairKey('next', '@auth/core'),
    );
    expect(withNext!.status).toBe('held');
  });

  it('orients a conflicting pair the way the conflict states it', () => {
    const pairs = enumeratePairs(['@auth/core', 'next-auth'], [
      {
        source: 'peer-deps',
        packages: ['next-auth', '@auth/core'],
        detail: 'x',
      },
    ]);
    // Argument order puts @auth/core first; the requirer still leads.
    expect(pairs[0]!.a).toBe('next-auth');
    expect(pairs[0]!.b).toBe('@auth/core');
  });

  it('does not double-count two conflicts over the same pair', () => {
    const c = { source: 'peer-deps' as const, packages: ['a', 'b'], detail: 'first' };
    const pairs = enumeratePairs(['a', 'b'], [c, { ...c, detail: 'second' }]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.detail).toBe('first');
  });
});

describe('edgeMatchesVersions (evidence is about exact versions)', () => {
  const edge = { packageA: 'react', packageB: 'next', versionA: '18.3.1', versionB: '14.2.0' };

  it('accepts an edge recorded at the versions under check', () => {
    const at = new Map([['react', '18.3.1'], ['next', '14.2.0']]);
    expect(edgeMatchesVersions(edge, at)).toBe(true);
  });

  it('rejects proof from a different major', () => {
    // The regression this exists for: react@18 + next@14 co-installing is not
    // evidence about react@19 + next@16, and a name-level match said it was.
    const at = new Map([['react', '19.2.4'], ['next', '16.2.9']]);
    expect(edgeMatchesVersions(edge, at)).toBe(false);
  });

  it('rejects a partial match', () => {
    const at = new Map([['react', '18.3.1'], ['next', '16.2.9']]);
    expect(edgeMatchesVersions(edge, at)).toBe(false);
  });

  it('rejects a member whose version we could not resolve', () => {
    const at = new Map<string, string | null>([['react', '18.3.1'], ['next', null]]);
    expect(edgeMatchesVersions(edge, at)).toBe(false);
  });

  it('rejects an edge naming a package not under check', () => {
    expect(edgeMatchesVersions(edge, new Map([['react', '18.3.1']]))).toBe(false);
  });
});
