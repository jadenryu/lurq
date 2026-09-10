/**
 * What a stranger types into the landing page's scan box.
 *
 * This parser is the first line of code a visitor ever runs, and every one of
 * its failure modes is silent: a URL that resolves to the wrong owner scans
 * somebody else's repo and reports it as theirs, and a profile misread as a
 * repo 404s on a name that exists. Neither throws.
 */
import { describe, expect, it } from 'vitest';
import { parseTarget } from '../src/github/publicScan';

describe('parseTarget', () => {
  it('reads the shapes people actually paste', () => {
    const repo = { kind: 'repo', owner: 'vercel', name: 'next.js' };
    expect(parseTarget('vercel/next.js')).toEqual(repo);
    expect(parseTarget('https://github.com/vercel/next.js')).toEqual(repo);
    expect(parseTarget('http://www.github.com/vercel/next.js/')).toEqual(repo);
    expect(parseTarget('github.com/vercel/next.js.git')).toEqual(repo);
    // A deep link to a file in the repo is still that repo.
    expect(parseTarget('github.com/vercel/next.js/tree/canary')).toEqual(repo);
    expect(parseTarget('  vercel/next.js  ')).toEqual(repo);
  });

  it('reads a profile as a profile', () => {
    const user = { kind: 'user', login: 'sindresorhus' };
    expect(parseTarget('sindresorhus')).toEqual(user);
    expect(parseTarget('@sindresorhus')).toEqual(user);
    expect(parseTarget('https://github.com/sindresorhus')).toEqual(user);
  });

  it('refuses what it cannot resolve', () => {
    expect(parseTarget('')).toBeNull();
    expect(parseTarget('   ')).toBeNull();
    expect(parseTarget('-leading-hyphen')).toBeNull();
    // Not a path traversal into someone else's namespace.
    expect(parseTarget('owner/../../etc/passwd')).toBeNull();
    expect(parseTarget('owner/na me')).toBeNull();
  });
});
