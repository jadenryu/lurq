/**
 * Pinned: a repo's advisories are counted at the version its range resolves to,
 * and when OSV cannot answer in full every dependency keeps the package-level
 * count and says which it is, rather than claiming a checked all-clear.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/pipeline/single', () => ({
  syncOnePackage: vi.fn().mockResolvedValue({ confidence: 'unproven', category: null }),
}));
vi.mock('../src/db/discovery', () => ({
  enqueueDemand: vi.fn().mockResolvedValue(undefined),
  setDiscoveryStatus: vi.fn().mockResolvedValue(undefined),
  recordIngestFailure: vi.fn().mockResolvedValue(1),
}));
vi.mock('../src/ingestion/sources/osv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ingestion/sources/osv')>()),
  queryVulnerableInstalls: vi.fn(),
}));

import { computeDrift } from '../src/github/drift';
import * as osv from '../src/ingestion/sources/osv';

const query = vi.mocked(osv.queryVulnerableInstalls);

/**
 * `lodash` has advisories on its latest release (package-level count 2) and a
 * version timeline that resolves `^4.17.0` to 4.17.21. `left` is clean at latest.
 */
function fakeDb() {
  return {
    select: (cols: Record<string, unknown>) => ({
      from: () => ({
        where: async () =>
          'version' in cols
            ? [
                { name: 'lodash', version: '4.17.10' },
                { name: 'lodash', version: '4.17.21' },
                { name: 'left', version: '1.0.0' },
              ]
            : [
                { name: 'lodash', latestVersion: '4.17.21', deprecated: false, advisories: [{}, {}] },
                { name: 'left', latestVersion: '1.0.0', deprecated: false, advisories: [] },
              ],
      }),
    }),
  } as never;
}

const manifest = [{ path: 'package.json', deps: { lodash: '^4.17.0', left: '1.0.0' } }];

describe('computeDrift advisories', () => {
  beforeEach(() => query.mockReset());

  it('counts advisories affecting the resolved version, not the package latest', async () => {
    // OSV: 4.17.21 (what ^4.17.0 resolves to) is clean; `left@1.0.0` has one.
    query.mockResolvedValue({ affected: new Map([['left@1.0.0', ['GHSA-left']]]), complete: true });

    const drift = await computeDrift(fakeDb(), manifest);
    const lodash = drift.deps.find((d) => d.name === 'lodash')!;
    const left = drift.deps.find((d) => d.name === 'left')!;

    expect(query).toHaveBeenCalledWith(
      expect.arrayContaining([
        { name: 'lodash', version: '4.17.21' },
        { name: 'left', version: '1.0.0' },
      ]),
    );
    expect(lodash).toMatchObject({ advisories: 0, advisoriesAt: 'resolved' });
    expect(left).toMatchObject({ advisories: 1, advisoriesAt: 'resolved' });
    expect(drift).toMatchObject({ advisories: 1, advisoriesExact: true });
  });

  it('keeps the package-level count, and labels it, when OSV cannot answer in full', async () => {
    query.mockResolvedValue({ affected: new Map(), complete: false });

    const drift = await computeDrift(fakeDb(), manifest);
    expect(drift.deps.find((d) => d.name === 'lodash')).toMatchObject({ advisories: 2, advisoriesAt: 'package' });
    expect(drift.advisoriesExact).toBe(false);
  });
});
