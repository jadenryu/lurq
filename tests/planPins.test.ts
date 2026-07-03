import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrFetchPackage } = vi.hoisted(() => ({ getOrFetchPackage: vi.fn() }));
vi.mock('../src/pipeline/single', () => ({ getOrFetchPackage }));

import { resolvePins } from '../src/mcp/plan';

const db = {} as never;
const row = (name: string) => ({
  name,
  category: 'utility',
  healthScore: 80,
  qualityScore: 70,
  confidence: 'proven',
  latestVersion: '1.0.0',
  weeklyDownloads: 1000,
  lastReleaseAt: null,
  repoUrl: null,
});

describe('resolvePins', () => {
  beforeEach(() => getOrFetchPackage.mockReset());

  it('turns a pinned package into a fixed, single-candidate slot', async () => {
    getOrFetchPackage.mockResolvedValue({ row: row('drizzle-orm') });
    const { slots, unresolved } = await resolvePins(db, ['drizzle-orm'], new Set());
    expect(slots).toHaveLength(1);
    expect(slots[0]!.recommended?.name).toBe('drizzle-orm');
    expect(slots[0]!.alternatives).toEqual([]); // fixed — optimizer can't swap it
    expect(unresolved).toEqual([]);
  });

  it('skips a pin the recommender already picked (no double slot)', async () => {
    getOrFetchPackage.mockResolvedValue({ row: row('zod') });
    const { slots } = await resolvePins(db, ['zod'], new Set(['zod']));
    expect(slots).toHaveLength(0);
    expect(getOrFetchPackage).not.toHaveBeenCalled();
  });

  it('reports a pin that does not exist on npm instead of dropping it', async () => {
    getOrFetchPackage.mockResolvedValue({ row: null });
    const { slots, unresolved } = await resolvePins(db, ['made-up-xyz'], new Set());
    expect(slots).toHaveLength(0);
    expect(unresolved).toEqual(['made-up-xyz']);
  });

  it('dedupes repeated pins', async () => {
    getOrFetchPackage.mockResolvedValue({ row: row('hono') });
    const { slots } = await resolvePins(db, ['hono', 'hono'], new Set());
    expect(slots).toHaveLength(1);
    expect(getOrFetchPackage).toHaveBeenCalledTimes(1);
  });
});
