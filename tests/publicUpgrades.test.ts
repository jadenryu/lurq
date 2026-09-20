/**
 * Pinned: only consecutive latest-of-major pairs become pages, the worker never
 * re-queues a version it already tried, renames are not double-listed as
 * removals, and a page never calls a type-only or renamed break clean.
 */
import { describe, expect, it } from 'vitest';
import {
  LIST_CAP,
  majorPairs,
  pendingUpgrade,
  toPublicUpgrade,
  unextractedSides,
  upgradeVerdict,
  type LatestOfMajor,
  type SurfaceDiffResult,
} from '../src/mcp/publicUpgrades';

const l = (major: number, version: string, stored = true, attempted = stored): LatestOfMajor => ({
  major,
  version,
  stored,
  attempted,
});

const diff = (over: Partial<SurfaceDiffResult> = {}): SurfaceDiffResult => ({
  removed: [],
  renamed: [],
  arityChanged: [],
  typeOnlyRemoved: [],
  deprecated: [],
  added: [],
  tier: 'shipped_js_ast',
  observedAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

describe('majorPairs', () => {
  it('pairs consecutive existing majors in order, whatever order they arrive in', () => {
    const pairs = majorPairs([l(16, '16.0.1'), l(14, '14.2.30'), l(15, '15.5.2')]);
    expect(pairs.map((p) => [p.fromVersion, p.toVersion])).toEqual([
      ['14.2.30', '15.5.2'],
      ['15.5.2', '16.0.1'],
    ]);
  });

  it('bridges a major that was never published, and keeps only the newest jumps', () => {
    const pairs = majorPairs(
      [l(1, '1.9.0'), l(2, '2.4.0'), l(4, '4.0.0'), l(5, '5.1.0'), l(6, '6.0.0')],
      3,
    );
    expect(pairs.map((p) => `${p.fromMajor}-to-${p.toMajor}`)).toEqual([
      '2-to-4',
      '4-to-5',
      '5-to-6',
    ]);
  });

  it('is ready only when both sides are stored, and empty for a single major', () => {
    expect(majorPairs([l(1, '1.0.0'), l(2, '2.0.0', false)])[0]!.ready).toBe(false);
    expect(majorPairs([l(3, '3.1.0')])).toEqual([]);
  });
});

describe('unextractedSides', () => {
  it('queues missing sides of the kept pairs, newest first, skipping ones already tried', () => {
    const latest = [
      l(1, '1.0.0', false, false), // outside the kept pairs
      l(2, '2.0.0', false, false),
      l(3, '3.0.0', false, true), // tried and failed: not retried
      l(4, '4.0.0', true),
      l(5, '5.0.0', false, false),
    ];
    expect(unextractedSides(latest, 3)).toEqual(['5.0.0', '2.0.0']);
  });

  it('queues nothing for a package with one major', () => {
    expect(unextractedSides([l(1, '1.0.0', false, false)])).toEqual([]);
  });
});

describe('upgradeVerdict', () => {
  it('orders worst first and never calls a rename or a type removal clean', () => {
    const none = { removed: [], renamed: [], arityChanged: [], typeOnlyRemoved: [] };
    expect(upgradeVerdict({ ...none, inconclusive: 'no surface' })).toBe('unknown');
    expect(upgradeVerdict({ ...none, renamed: [1] })).toBe('removes-exports');
    expect(upgradeVerdict({ ...none, arityChanged: [1], typeOnlyRemoved: [1] })).toBe(
      'arity-changed',
    );
    expect(upgradeVerdict({ ...none, typeOnlyRemoved: [1] })).toBe('types-only');
    expect(upgradeVerdict(none)).toBe('clean');
  });
});

describe('toPublicUpgrade', () => {
  const pair = majorPairs([l(1, '1.0.0'), l(2, '2.0.0')])[0]!;

  it('lists a rename once, under renamed, and counts additions', () => {
    const u = toPublicUpgrade(
      'pkg',
      pair,
      diff({
        removed: [
          { path: 'oldName', kind: 'function' },
          { path: 'gone', kind: 'class' },
        ],
        renamed: [{ path: 'oldName', to: ['newName'] }],
        added: [{}, {}, {}],
      }),
    );
    expect(u.removed).toEqual([{ path: 'gone', kind: 'class' }]);
    expect(u.renamed).toEqual([{ path: 'oldName', to: ['newName'] }]);
    expect(u).toMatchObject({
      status: 'ready',
      verdict: 'removes-exports',
      added: 3,
      truncated: false,
    });
    expect(u.observedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('caps each list and says it did', () => {
    const many = Array.from({ length: LIST_CAP + 5 }, (_, i) => `t${i}`);
    const u = toPublicUpgrade('pkg', pair, diff({ typeOnlyRemoved: many }));
    expect(u.typeOnlyRemoved).toHaveLength(LIST_CAP);
    expect(u.truncated).toBe(true);
    expect(u.verdict).toBe('types-only');
  });

  it('keeps an inconclusive diff unknown rather than clean', () => {
    expect(toPublicUpgrade('pkg', pair, diff({ inconclusive: 'cross-tier' })).verdict).toBe(
      'unknown',
    );
  });

  it('answers a pending pair as unknown with empty lists', () => {
    expect(pendingUpgrade('pkg', pair)).toMatchObject({
      status: 'pending',
      verdict: 'unknown',
      removed: [],
      added: 0,
    });
  });
});
