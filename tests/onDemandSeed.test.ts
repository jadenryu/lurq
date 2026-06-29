import { describe, it, expect, vi, beforeEach } from 'vitest';

// The on-demand path (getOrFetchPackage → syncOnePackage) touches the DB,
// network, scoring, summaries, and embeddings. We mock every collaborator so we
// can exercise the *branching* — specifically whether a discovery is promoted
// into the seed list — without any of that machinery.
vi.mock('../src/db/packages', () => ({
  getPackageByName: vi.fn(),
  upsertPackage: vi.fn().mockResolvedValue(undefined),
  upsertPackageVersions: vi.fn().mockResolvedValue(undefined),
  ensureSeedEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/ingestion/sources', () => ({
  npmPackageExists: vi.fn(),
  fetchWeeklyDownloads: vi.fn().mockResolvedValue(null),
}));
vi.mock('../src/ingestion/collect', () => ({
  collectSignals: vi.fn().mockResolvedValue({ registry: { description: null } }),
}));
vi.mock('../src/ingestion/summarize', () => ({
  buildSummaryInput: vi.fn().mockResolvedValue({}),
  createSummaryProvider: vi.fn(() => ({
    generate: vi.fn().mockResolvedValue({ summary: 's', usageGuide: null }),
  })),
}));
vi.mock('../src/search/embeddings', () => ({
  buildEmbeddingText: vi.fn(() => 'text'),
  createEmbeddingProvider: vi.fn(() => ({ embed: vi.fn().mockResolvedValue([null]) })),
}));
vi.mock('../src/scoring', () => ({
  toScoringInput: vi.fn(() => ({})),
  computeMaintenance: vi.fn(() => 0),
  computeAdoption: vi.fn(() => 0),
  computeReliability: vi.fn(() => 0),
  computeEfficiency: vi.fn(() => null),
  computeQuality: vi.fn(() => null),
  computeHealthScore: vi.fn(() => 0),
  computeConfidence: vi.fn(() => 'emerging'),
}));
vi.mock('../src/pipeline/sync', () => ({ assemblePackageRow: vi.fn(() => ({ name: 'x' })) }));
vi.mock('../src/core/config', () => ({ getConfig: vi.fn(() => ({ GITHUB_TOKEN: undefined })) }));

import { getOrFetchPackage } from '../src/pipeline/single';
import * as pkgs from '../src/db/packages';
import * as sources from '../src/ingestion/sources';
import type { PackageRow } from '../src/db/schema';

const getPackageByName = vi.mocked(pkgs.getPackageByName);
const ensureSeedEntry = vi.mocked(pkgs.ensureSeedEntry);
const npmPackageExists = vi.mocked(sources.npmPackageExists);

// Minimal chainable fake DB: every query (select().from().where()[.limit()])
// resolves to an empty result set, which the single-package path tolerates.
function fakeDb() {
  const p = Promise.resolve([] as unknown[]);
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  return { select: () => chain } as never;
}

describe('getOrFetchPackage — on-demand seed promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT seed a package that is already tracked', async () => {
    const tracked = { name: 'zod', category: 'validation' } as unknown as PackageRow;
    getPackageByName.mockResolvedValue(tracked);

    const res = await getOrFetchPackage(fakeDb(), 'zod');

    expect(res.wasTracked).toBe(true);
    expect(ensureSeedEntry).not.toHaveBeenCalled();
  });

  it('does NOT seed a name that does not exist on npm', async () => {
    getPackageByName.mockResolvedValue(null);
    npmPackageExists.mockResolvedValue(false);

    const res = await getOrFetchPackage(fakeDb(), 'definitely-not-a-real-pkg-xyz');

    expect(res.existsOnNpm).toBe(false);
    expect(res.row).toBeNull();
    expect(ensureSeedEntry).not.toHaveBeenCalled();
  });

  it('seeds a fresh discovery with the resolved category', async () => {
    const stored = { name: 'leftpad', category: 'utility' } as unknown as PackageRow;
    // Untracked on the first two lookups (getOrFetchPackage + syncOnePackage),
    // then the stored row once it has been upserted.
    getPackageByName
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(stored);
    npmPackageExists.mockResolvedValue(true);

    const db = fakeDb();
    const res = await getOrFetchPackage(db, 'leftpad');

    expect(res.wasTracked).toBe(false);
    expect(res.row).toBe(stored);
    expect(ensureSeedEntry).toHaveBeenCalledTimes(1);
    expect(ensureSeedEntry).toHaveBeenCalledWith(db, 'leftpad', 'utility');
  });
});
