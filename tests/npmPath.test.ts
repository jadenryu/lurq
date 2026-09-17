/**
 * Pinned: /npm/<name>/<from>-to-<to> is an upgrade page only when the segments
 * before the jump are a whole package name, so a scoped package whose name looks
 * like a jump still resolves to its own page.
 */
import { describe, expect, it } from 'vitest';
import { parseNpmPath, upgradePath } from '../apps/web/src/lib/npm-path';

describe('parseNpmPath', () => {
  it('reads a trailing jump as an upgrade of the package before it', () => {
    expect(parseNpmPath(['next', '15-to-16'])).toEqual({ kind: 'upgrade', name: 'next', from: 15, to: 16 });
    expect(parseNpmPath(['@tanstack', 'react-query', '4-to-5'])).toEqual({
      kind: 'upgrade',
      name: '@tanstack/react-query',
      from: 4,
      to: 5,
    });
  });

  it('keeps packages as packages, including a scoped name that looks like a jump', () => {
    expect(parseNpmPath(['react'])).toEqual({ kind: 'package', name: 'react' });
    expect(parseNpmPath(['@scope', '1-to-2'])).toEqual({ kind: 'package', name: '@scope/1-to-2' });
    expect(parseNpmPath(['%40babel', 'core'])).toEqual({ kind: 'package', name: '@babel/core' });
  });

  it('refuses a jump that does not go forward', () => {
    expect(parseNpmPath(['next', '16-to-15']).kind).toBe('package');
    expect(parseNpmPath(['next', '16-to-16']).kind).toBe('package');
  });

  it('builds the path it parses', () => {
    expect(upgradePath('@tanstack/react-query', 4, 5)).toBe('/npm/%40tanstack/react-query/4-to-5');
  });
});
