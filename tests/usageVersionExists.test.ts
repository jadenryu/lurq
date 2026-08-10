import { describe, it, expect, vi, beforeEach } from 'vitest';

// `usage --target 999.0.0` used to answer "no extracted API surface for this
// version yet; fall back to the README" for a release that does not exist —
// indistinguishable from a version we simply have not indexed. An agent acting
// on that writes code against an imaginary release.
vi.mock('../src/ingestion/sources', () => ({
  npmVersionExists: vi.fn(),
  fetchNpmRegistry: vi.fn(),
  fetchNpmCompatAtVersion: vi.fn().mockResolvedValue(null),
  fetchWeeklyDownloads: vi.fn(),
  npmPackageExists: vi.fn(),
}));
vi.mock('../src/usage/service', () => ({
  getOrExtractSurface: vi.fn(),
  USAGE_EXTRACT_BUDGET_MS: 4000,
}));
vi.mock('../src/db/packages', () => ({
  getPackageByName: vi.fn().mockResolvedValue(null),
  getTopPackageNames: vi.fn(),
  getContributionsByOwner: vi.fn(),
}));

import { handleUsage } from '../src/mcp/handlers';
import * as sources from '../src/ingestion/sources';
import * as service from '../src/usage/service';

const npmVersionExists = vi.mocked(sources.npmVersionExists);
const getOrExtractSurface = vi.mocked(service.getOrExtractSurface);
const db = {} as never;

describe('usage — an unpublished version is not "no data yet"', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a version npm has never published', async () => {
    npmVersionExists.mockResolvedValue(false);

    const res = await handleUsage(db, { package: 'react', version: '999.0.0' });

    expect(res.unpublishedVersion).toBe('999.0.0');
    expect(res.available).toBe(false);
    expect(res.note).toContain('does not exist');
    // The old wording sent the agent to a README for a release with no README.
    expect(res.note).not.toContain('fall back to the README');
    // Nothing was looked up: there is no surface to have.
    expect(getOrExtractSurface).not.toHaveBeenCalled();
  });

  it('serves the requested version when npm is unreachable, rather than blaming the caller', async () => {
    npmVersionExists.mockResolvedValue(null); // could not ask
    getOrExtractSurface.mockResolvedValue([{ name: 'useState', kind: 'function' }] as never);

    const res = await handleUsage(db, { package: 'react', version: '19.0.0' });

    expect(res.unpublishedVersion).toBeUndefined();
    expect(res.version).toBe('19.0.0');
    expect(res.available).toBe(true);
  });

  it('says why a requested delta is missing instead of omitting it silently', async () => {
    npmVersionExists.mockImplementation(async (_n, v) => v !== '0.0.0-nope');
    getOrExtractSurface.mockImplementation(async (_db, _n, version) =>
      version === '19.0.0' ? ([{ name: 'useState', kind: 'function' }] as never) : null,
    );

    const res = await handleUsage(db, {
      package: 'react',
      version: '19.0.0',
      knownVersion: '0.0.0-nope',
    });

    expect(res.delta).toBeUndefined();
    expect(res.deltaNote).toContain('does not exist');
  });

  it('distinguishes an unindexed known version from a fictional one', async () => {
    npmVersionExists.mockResolvedValue(true);
    getOrExtractSurface.mockImplementation(async (_db, _n, version) =>
      version === '19.0.0' ? ([{ name: 'useState', kind: 'function' }] as never) : null,
    );

    const res = await handleUsage(db, {
      package: 'react',
      version: '19.0.0',
      knownVersion: '18.2.0',
    });

    expect(res.delta).toBeUndefined();
    expect(res.deltaNote).toContain('no API surface extracted');
    expect(res.deltaNote).not.toContain('does not exist');
  });
});
