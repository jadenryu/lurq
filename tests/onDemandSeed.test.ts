import { describe, it, expect, vi, beforeEach } from 'vitest';

// getOrFetchPackage is now async on-demand: it resolves tracked packages, reports
// non-existent names, and *enqueues* real-but-untracked ones for background
// ingestion instead of fetching inline. Mock its three collaborators.
vi.mock('../src/db/packages', () => ({ getPackageByName: vi.fn() }));
vi.mock('../src/ingestion/sources', () => ({
  npmPackageExists: vi.fn(),
  fetchWeeklyDownloads: vi.fn(),
}));
vi.mock('../src/pipeline/ingestQueue', () => ({ enqueueIngest: vi.fn() }));

import { getOrFetchPackage } from '../src/pipeline/single';
import * as pkgs from '../src/db/packages';
import * as sources from '../src/ingestion/sources';
import * as queue from '../src/pipeline/ingestQueue';
import type { PackageRow } from '../src/db/schema';

const getPackageByName = vi.mocked(pkgs.getPackageByName);
const npmPackageExists = vi.mocked(sources.npmPackageExists);
const enqueueIngest = vi.mocked(queue.enqueueIngest);

describe('getOrFetchPackage — async on-demand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a tracked package without enqueuing', async () => {
    const tracked = { name: 'zod' } as unknown as PackageRow;
    getPackageByName.mockResolvedValue(tracked);

    const res = await getOrFetchPackage({} as never, 'zod');

    expect(res.wasTracked).toBe(true);
    expect(res.row).toBe(tracked);
    expect(enqueueIngest).not.toHaveBeenCalled();
  });

  it('reports a non-existent name without enqueuing', async () => {
    getPackageByName.mockResolvedValue(null);
    npmPackageExists.mockResolvedValue(false);

    const res = await getOrFetchPackage({} as never, 'definitely-not-real-xyz');

    expect(res.existsOnNpm).toBe(false);
    expect(res.row).toBeNull();
    expect(enqueueIngest).not.toHaveBeenCalled();
  });

  it('enqueues a real-but-untracked package and returns queued — no inline work', async () => {
    getPackageByName.mockResolvedValue(null);
    npmPackageExists.mockResolvedValue(true);
    const db = {} as never;

    const res = await getOrFetchPackage(db, 'freshpkg');

    expect(res).toEqual({ row: null, wasTracked: false, existsOnNpm: true, queued: true });
    expect(enqueueIngest).toHaveBeenCalledWith(db, 'freshpkg');
  });
});
