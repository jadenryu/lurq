import { describe, it, expect } from 'vitest';
import { releaseVerdict, formatReleaseCheck, type ReleaseCheck } from '../src/surface/release';

const diff = (d: Partial<Record<'removed' | 'arityChanged' | 'typeOnlyRemoved' | 'added', number>>) => ({
  removed: Array(d.removed ?? 0).fill(0),
  arityChanged: Array(d.arityChanged ?? 0).fill(0),
  typeOnlyRemoved: Array(d.typeOnlyRemoved ?? 0).fill(0),
  added: Array(d.added ?? 0).fill(0),
});

describe('releaseVerdict', () => {
  it('calls a removed export a major, and catches it tagged as a patch', () => {
    const v = releaseVerdict('1.2.3', '1.2.4', diff({ removed: 1 }));
    expect(v).toEqual({ declared: 'patch', required: 'major', verdict: 'understated' });
  });

  it('passes a removal shipped as a major', () => {
    expect(releaseVerdict('1.2.3', '2.0.0', diff({ removed: 1 })).verdict).toBe('ok');
  });

  it('reads a prerelease by its numbers, not as a `premajor`', () => {
    const v = releaseVerdict('1.2.3', '2.0.0-rc.1', diff({ removed: 1 }));
    expect(v).toEqual({ declared: 'major', required: 'major', verdict: 'ok' });
  });

  it('accepts a 0.x minor as the breaking channel', () => {
    expect(releaseVerdict('0.2.0', '0.3.0', diff({ removed: 1 })).verdict).toBe('ok');
    expect(releaseVerdict('0.2.0', '0.2.1', diff({ removed: 1 })).verdict).toBe('understated');
  });

  it('needs a minor for a new export and a patch for no change', () => {
    expect(releaseVerdict('1.0.0', '1.0.1', diff({ added: 1 })).required).toBe('minor');
    expect(releaseVerdict('1.0.0', '1.0.1', diff({})).verdict).toBe('ok');
  });

  it('counts an arity change and a removed type as breaking', () => {
    expect(releaseVerdict('1.0.0', '1.0.1', diff({ arityChanged: 1 })).required).toBe('major');
    expect(releaseVerdict('1.0.0', '1.0.1', diff({ typeOnlyRemoved: 1 })).required).toBe('major');
  });

  it('refuses a version that is not ahead of the published one', () => {
    const v = releaseVerdict('1.2.3', '1.2.3', diff({}));
    expect(v).toEqual({ declared: null, required: 'patch', verdict: 'understated' });
  });
});

describe('formatReleaseCheck', () => {
  const base: ReleaseCheck = {
    package: 'demo',
    publishedVersion: '1.2.3',
    localVersion: '1.2.4',
    declared: 'patch',
    required: 'major',
    verdict: 'understated',
    removed: ['parseOpts'],
    arityChanged: [],
    typeOnlyRemoved: [],
    added: [],
  };

  it('names the symbol and both levels', () => {
    const out = formatReleaseCheck(base);
    expect(out).toContain('UNDERSTATED');
    expect(out).toContain('parseOpts');
    expect(out).toMatch(/tagged patch.*major/);
  });

  it('never renders an inconclusive check as a pass', () => {
    const out = formatReleaseCheck({
      ...base,
      verdict: 'inconclusive',
      inconclusive: 'no resolvable JS entry point',
    });
    expect(out).toContain('INCONCLUSIVE');
    expect(out).toContain('not a pass');
    expect(out).not.toContain('OK ');
  });
});
