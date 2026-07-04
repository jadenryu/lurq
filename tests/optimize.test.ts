import { describe, it, expect } from 'vitest';
import { optimizeStack } from '../src/compat/optimize';
import type { CompatMember } from '../src/compat/peerCompat';

const m = (name: string, over: Partial<CompatMember> = {}): CompatMember => ({
  name,
  version: '1.0.0',
  peerDependencies: null,
  peerDependenciesMeta: null,
  engines: null,
  ...over,
});

describe('optimizeStack', () => {
  it('keeps all top picks when they are already compatible', () => {
    const r = optimizeStack([[m('react', { version: '19.0.0' })], [m('zustand')]]);
    expect(r.selection).toEqual([0, 0]);
    expect(r.regret).toBe(0);
    expect(r.conflicts).toEqual([]);
    expect(r.bounded).toBe(false); // completed within budget → proven optimum
  });

  it('swaps a slot to resolve a conflict, minimizing regret', () => {
    const r = optimizeStack([
      [m('react', { version: '18.2.0' })],
      [
        m('plugin-19', { peerDependencies: { react: '^19' } }),
        m('plugin-18', { peerDependencies: { react: '^18' } }),
      ],
    ]);
    expect(r.selection).toEqual([0, 1]);
    expect(r.conflicts).toEqual([]);
    expect(r.regret).toBe(1);
  });

  it('only swaps the slot that needs it (minimal global regret)', () => {
    const r = optimizeStack([
      [m('react', { version: '18.2.0' })],
      [m('a', { peerDependencies: { react: '^18' } }), m('a2')], // top already fine
      [
        m('b-19', { peerDependencies: { react: '^19' } }),
        m('b-18', { peerDependencies: { react: '^18' } }),
      ],
    ]);
    expect(r.selection).toEqual([0, 0, 1]);
    expect(r.conflicts).toEqual([]);
  });

  it('returns the top picks with conflicts when nothing resolves', () => {
    const r = optimizeStack([
      [m('react', { version: '18.2.0' })],
      [m('only-19', { peerDependencies: { react: '^19' } })],
    ]);
    expect(r.selection).toEqual([0, 0]);
    expect(r.conflicts.length).toBeGreaterThan(0);
  });

  it('avoids a recorded sandbox-conflict pair', () => {
    const r = optimizeStack([[m('x')], [m('y-bad'), m('y-ok')]], new Set(['x|y-bad']));
    expect(r.selection).toEqual([0, 1]);
    expect(r.conflicts).toEqual([]);
  });
});
