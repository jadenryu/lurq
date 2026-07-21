import { describe, it, expect } from 'vitest';
import {
  resolveArchitectureCompat,
  resolveRuntimeEngineConflicts,
  type CompatMember,
} from '../src/compat/peerCompat';

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

  it('flags a package whose engines.node excludes the target runtime', () => {
    const out = resolveRuntimeEngineConflicts(
      [
        member({ name: 'express', version: '5.0.0', engines: { node: '>=18' } }),
        member({
          name: '@angular/core',
          version: '22.0.7',
          engines: { node: '^22.22.3 || ^24.15.0 || >=26.0.0' },
        }),
      ],
      '20.20.2',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'engines', packages: ['@angular/core'] });
  });

  it('flags React 19 pinned against spring peers that only allow 16-18', () => {
    const out = resolveArchitectureCompat([
      member({ name: 'react', version: '19.2.7' }),
      member({ name: 'react-dom', version: '19.2.7', peerDependencies: { react: '^19.0.0' } }),
      member({
        name: '@react-spring/web',
        version: '9.7.5',
        peerDependencies: {
          react: '^16.8.0 || ^17.0.0 || ^18.0.0',
          'react-dom': '^16.8.0 || ^17.0.0 || ^18.0.0',
        },
      }),
    ]);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.some((c) => c.source === 'peer-deps' && c.packages.includes('@react-spring/web'))).toBe(
      true,
    );
  });
});
