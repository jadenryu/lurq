import { describe, it, expect } from 'vitest';
import { previousVersion } from '../src/db/surface';

// Newest-first, the order `getPackageVersions` returns.
const timeline = [{ version: '4.1.0' }, { version: '4.0.0' }, { version: '3.9.2' }];

describe('previousVersion (what makes a surface diffable)', () => {
  it('returns the version published immediately before', () => {
    expect(previousVersion(timeline, '4.1.0')).toBe('4.0.0');
    expect(previousVersion(timeline, '4.0.0')).toBe('3.9.2');
  });
  it('returns null at the oldest version we know — nothing to compare to', () => {
    expect(previousVersion(timeline, '3.9.2')).toBeNull();
  });
  it('returns null for a version not on the timeline', () => {
    expect(previousVersion(timeline, '9.9.9')).toBeNull();
  });
  it('returns null on an empty timeline rather than throwing', () => {
    expect(previousVersion([], '1.0.0')).toBeNull();
  });
  it('follows publication order, not semver order', () => {
    // A 3.9.2 backport shipped AFTER 4.0.0: the predecessor by time is 4.0.0,
    // which is what "what changed when this was released" actually asks.
    const backport = [{ version: '3.9.2' }, { version: '4.0.0' }, { version: '3.9.1' }];
    expect(previousVersion(backport, '3.9.2')).toBe('4.0.0');
  });
});
