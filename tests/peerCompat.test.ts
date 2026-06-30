import { describe, it, expect } from 'vitest';
import { resolveArchitectureCompat, type CompatMember } from '../src/compat/peerCompat';

function member(over: Partial<CompatMember> & { name: string }): CompatMember {
  return {
    version: null,
    peerDependencies: null,
    peerDependenciesMeta: null,
    engines: null,
    ...over,
  };
}

describe('resolveArchitectureCompat', () => {
  it('clears a stack with no peer constraints', () => {
    const out = resolveArchitectureCompat([
      member({ name: 'lodash', version: '4.17.21' }),
      member({ name: 'zod', version: '3.23.0' }),
    ]);
    expect(out).toEqual([]);
  });

  it('passes when a pinned peer satisfies the declared range', () => {
    const out = resolveArchitectureCompat([
      member({ name: 'react', version: '19.0.0' }),
      member({ name: 'react-dom', version: '19.0.0', peerDependencies: { react: '^19' } }),
    ]);
    expect(out).toEqual([]);
  });

  it('flags a pinned peer that violates the declared range', () => {
    const out = resolveArchitectureCompat([
      member({ name: 'react', version: '18.2.0' }),
      member({ name: 'needs19', version: '1.0.0', peerDependencies: { react: '^19' } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'peer-deps', packages: ['needs19', 'react'] });
  });

  it('flags two members that need non-overlapping versions of an unpinned peer', () => {
    const out = resolveArchitectureCompat([
      member({ name: 'plugin-a', version: '1.0.0', peerDependencies: { eslint: '^8' } }),
      member({ name: 'plugin-b', version: '1.0.0', peerDependencies: { eslint: '^9' } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'peer-deps' });
    expect(out[0]!.packages.sort()).toEqual(['plugin-a', 'plugin-b']);
  });

  it('does not flag overlapping ranges of a shared peer', () => {
    const out = resolveArchitectureCompat([
      member({ name: 'plugin-a', version: '1.0.0', peerDependencies: { eslint: '>=8' } }),
      member({ name: 'plugin-b', version: '1.0.0', peerDependencies: { eslint: '^9' } }),
    ]);
    expect(out).toEqual([]);
  });

  it('ignores optional peers when they are not pinned', () => {
    const out = resolveArchitectureCompat([
      member({
        name: 'plugin-a',
        version: '1.0.0',
        peerDependencies: { typescript: '^4' },
        peerDependenciesMeta: { typescript: { optional: true } },
      }),
      member({
        name: 'plugin-b',
        version: '1.0.0',
        peerDependencies: { typescript: '^5' },
        peerDependenciesMeta: { typescript: { optional: true } },
      }),
    ]);
    expect(out).toEqual([]);
  });

  it('flags incompatible node engine ranges', () => {
    const out = resolveArchitectureCompat([
      member({ name: 'old', version: '1.0.0', engines: { node: '<=16' } }),
      member({ name: 'new', version: '1.0.0', engines: { node: '>=20' } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'engines' });
  });
});
