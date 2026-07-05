import { describe, it, expect } from 'vitest';
import { lookupSuccessor } from '../src/core/successors';
import { rowToEvaluate } from '../src/mcp/handlers';
import type { PackageRow } from '../src/db/schema';

describe('lookupSuccessor', () => {
  it('maps a superseded package to its replacement', () => {
    expect(lookupSuccessor('moment')).toEqual({
      name: 'dayjs',
      reason: expect.stringContaining('maintenance'),
    });
  });

  it('is case-insensitive', () => {
    expect(lookupSuccessor('TSLint')?.name).toBe('typescript-eslint');
  });

  it('returns null for a healthy package', () => {
    expect(lookupSuccessor('react')).toBeNull();
  });
});

describe('rowToEvaluate replacedBy', () => {
  const base = { id: 1, healthScore: 50, deprecated: false, archived: false } as Partial<PackageRow>;

  it('surfaces a successor when the package is superseded', () => {
    const out = rowToEvaluate({ ...base, name: 'request' } as PackageRow);
    expect(out.replacedBy?.name).toBe('got');
  });

  it('is null for a package with no known successor', () => {
    const out = rowToEvaluate({ ...base, name: 'express' } as PackageRow);
    expect(out.replacedBy).toBeNull();
  });
});
