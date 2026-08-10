import { describe, it, expect, vi, beforeEach } from 'vitest';

// `compare` used to collapse two different causes of a missing row into one
// "🎉 you're the first to add these" note, so an agent comparing a hallucinated
// package name was told it was real and being scored. These lock the split.
vi.mock('../src/pipeline/single', () => ({
  getOrFetchPackage: vi.fn(),
  FIRST_TOUCH_BUDGET_MS: 4000,
}));
// Cache off: run the compute path directly.
vi.mock('../src/core/cache', () => ({ cached: (_ns: string, _k: string, fn: () => unknown) => fn() }));
vi.mock('../src/db/selectionPolicy', () => ({
  getSelectionPolicy: vi.fn().mockResolvedValue(null),
  loadPolicyFacts: vi.fn().mockResolvedValue(new Map()),
}));

import { handleCompare } from '../src/mcp/handlers';
import * as single from '../src/pipeline/single';
import type { PackageRow } from '../src/db/schema';

const getOrFetchPackage = vi.mocked(single.getOrFetchPackage);

/** `latestDataAsOf` runs one aggregate select; that's all compare needs of a db. */
const db = {
  select: () => ({ from: async () => [{ m: new Date('2026-01-01').toISOString() }] }),
} as never;

const tracked = (name: string) =>
  ({ name, healthScore: 50, scoreBreakdown: null, advisories: null, dataAsOf: new Date() }) as unknown as PackageRow;

function mockResults(map: Record<string, { row: PackageRow | null; existsOnNpm: boolean }>) {
  getOrFetchPackage.mockImplementation(async (_db, name) => ({
    ...map[name]!,
    wasTracked: Boolean(map[name]!.row),
  }));
}

describe('compare — a name off npm is never reported as "being scored"', () => {
  beforeEach(() => vi.clearAllMocks());

  it('separates a non-existent name from a real one still being ingested', async () => {
    mockResults({
      react: { row: tracked('react'), existsOnNpm: true },
      'zzz-not-real': { row: null, existsOnNpm: false },
      freshpkg: { row: null, existsOnNpm: true },
    });

    const res = await handleCompare(db, { packages: ['react', 'zzz-not-real', 'freshpkg'] });

    expect(res.notFound).toEqual(['zzz-not-real']);
    expect(res.pending).toEqual(['freshpkg']);
    // The union stays, in the caller's order, for clients pinned to an older lurq.
    expect(res.missing).toEqual(['zzz-not-real', 'freshpkg']);
    expect(res.note).toContain('Not found on the npm registry: zzz-not-real');
    expect(res.note).toContain("first to add freshpkg");
  });

  it('never congratulates the caller when nothing is pending', async () => {
    mockResults({
      react: { row: tracked('react'), existsOnNpm: true },
      'zzz-not-real': { row: null, existsOnNpm: false },
    });

    const res = await handleCompare(db, { packages: ['react', 'zzz-not-real'] });

    expect(res.pending).toBeUndefined();
    expect(res.note).not.toContain('🎉');
    expect(res.note).toContain('do not exist');
  });

  it('omits every miss field when both packages resolve', async () => {
    mockResults({
      react: { row: tracked('react'), existsOnNpm: true },
      vue: { row: tracked('vue'), existsOnNpm: true },
    });

    const res = await handleCompare(db, { packages: ['react', 'vue'] });

    expect(res.missing).toBeUndefined();
    expect(res.notFound).toBeUndefined();
    expect(res.note).toBeUndefined();
    expect(res.rows).toHaveLength(2);
  });
});
