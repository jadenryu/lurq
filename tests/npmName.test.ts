import { describe, it, expect } from 'vitest';
import { npmName } from '../src/mcp/server';

describe('npmName validation (trust boundary)', () => {
  it('accepts valid package names', () => {
    for (const name of ['react', 'lodash.merge', 'react-dom', '@scope/pkg', '@a/b-c.d', 'a']) {
      expect(npmName.safeParse(name).success).toBe(true);
    }
  });

  it('rejects path / query / fragment injection into the registry URL', () => {
    for (const name of [
      'foo/bar', // extra path segment on an unscoped name
      'foo?x=y', // query injection
      'foo#frag',
      'foo%2e%2e',
      '../etc/passwd',
      'foo bar', // whitespace
      'foo\nbar', // control char
      '@scope/a/b', // second slash
      '', // empty
      'a'.repeat(215), // over npm's 214-char limit
    ]) {
      expect(npmName.safeParse(name).success).toBe(false);
    }
  });
});
