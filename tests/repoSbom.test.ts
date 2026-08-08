import { describe, it, expect, vi } from 'vitest';
import { parseNpmPurl, parseSbom, SBOM_NODE_CAP } from '../src/github/sbom';
import { computeTransitiveDrift } from '../src/github/drift';

describe('parseNpmPurl', () => {
  it('parses a plain package', () => {
    expect(parseNpmPurl('pkg:npm/lodash@4.17.21')).toEqual({
      name: 'lodash',
      version: '4.17.21',
    });
  });

  it('parses a percent-encoded scoped package', () => {
    // The naive `split("@")` bug: scoped names contain an `@` that is not the
    // version separator, so every scoped dependency parses wrong.
    expect(parseNpmPurl('pkg:npm/%40babel/core@7.24.0')).toEqual({
      name: '@babel/core',
      version: '7.24.0',
    });
  });

  it('parses a scoped package that was not encoded', () => {
    // Producers emit both forms interchangeably.
    expect(parseNpmPurl('pkg:npm/@types/node@26.1.1')).toEqual({
      name: '@types/node',
      version: '26.1.1',
    });
  });

  it('drops qualifiers and subpaths', () => {
    expect(parseNpmPurl('pkg:npm/esbuild@0.25.0?arch=arm64#linux')).toEqual({
      name: 'esbuild',
      version: '0.25.0',
    });
  });

  it('ignores non-npm ecosystems', () => {
    // A repo's SBOM also lists GitHub Actions, Docker images, and more.
    expect(parseNpmPurl('pkg:githubactions/actions/checkout@v6')).toBeNull();
    expect(parseNpmPurl('pkg:pypi/requests@2.31.0')).toBeNull();
  });

  it('returns null for a versionless purl rather than inventing one', () => {
    expect(parseNpmPurl('pkg:npm/lodash')).toBeNull();
    expect(parseNpmPurl('pkg:npm/@babel/core')).toBeNull();
  });
});

const spdx = (packages: unknown[]) => ({ sbom: { packages } });
const purlPkg = (locator: string) => ({
  externalRefs: [{ referenceType: 'purl', referenceLocator: locator }],
});

describe('parseSbom', () => {
  it('extracts npm nodes and skips other ecosystems', () => {
    const deps = parseSbom(
      spdx([
        purlPkg('pkg:npm/lodash@4.17.21'),
        purlPkg('pkg:githubactions/actions/checkout@v6'),
        purlPkg('pkg:npm/%40babel/core@7.24.0'),
      ]),
    );
    expect(deps).toEqual([
      { name: 'lodash', version: '4.17.21' },
      { name: '@babel/core', version: '7.24.0' },
    ]);
  });

  it('falls back to the npm: name form when no purl is present', () => {
    expect(parseSbom(spdx([{ name: 'npm:lodash', versionInfo: '4.17.21' }]))).toEqual([
      { name: 'lodash', version: '4.17.21' },
    ]);
  });

  it('ignores a fallback name with no version', () => {
    expect(parseSbom(spdx([{ name: 'npm:lodash' }]))).toEqual([]);
  });

  it('dedupes identical name@version nodes', () => {
    const deps = parseSbom(
      spdx([purlPkg('pkg:npm/lodash@4.17.21'), purlPkg('pkg:npm/lodash@4.17.21')]),
    );
    expect(deps).toHaveLength(1);
  });

  it('keeps distinct versions of the same package', () => {
    // Real trees carry several copies of a package at different versions.
    const deps = parseSbom(
      spdx([purlPkg('pkg:npm/lodash@4.17.20'), purlPkg('pkg:npm/lodash@4.17.21')]),
    );
    expect(deps).toHaveLength(2);
  });

  it('caps a runaway tree', () => {
    const many = Array.from({ length: SBOM_NODE_CAP + 50 }, (_, i) =>
      purlPkg(`pkg:npm/pkg-${i}@1.0.0`),
    );
    expect(parseSbom(spdx(many))).toHaveLength(SBOM_NODE_CAP);
  });

  it('returns nothing for a malformed document instead of throwing', () => {
    expect(parseSbom(null)).toEqual([]);
    expect(parseSbom({ sbom: {} })).toEqual([]);
    expect(parseSbom({ sbom: { packages: 'nope' } })).toEqual([]);
  });
});

/** Minimal drizzle stub: one `select…from…where` returning fixed package rows. */
function stubDb(rows: { name: string; latestVersion: string | null; deprecated: boolean; advisories: unknown[] | null }[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => rows) })),
    })),
  } as never;
}

describe('computeTransitiveDrift', () => {
  const resolved = [
    { name: 'react', version: '19.0.0' },
    { name: 'lodash', version: '4.17.20' },
    { name: 'request', version: '2.88.2' },
    { name: 'left-pad', version: '1.3.0' },
  ];
  const direct = new Set(['react']);

  it('excludes direct dependencies — those are the manifest view', async () => {
    const db = stubDb([]);
    const result = await computeTransitiveDrift(db, resolved, direct, false);
    expect(result.resolved).toBe(3);
  });

  it('reports only indexed transitives carrying a signal', async () => {
    const db = stubDb([
      { name: 'lodash', latestVersion: '4.17.21', deprecated: false, advisories: [{ id: 'a' }] },
      { name: 'request', latestVersion: '2.88.2', deprecated: true, advisories: [] },
      { name: 'left-pad', latestVersion: '1.3.0', deprecated: false, advisories: [] },
    ]);
    const result = await computeTransitiveDrift(db, resolved, direct, false);
    expect(result.tracked).toBe(3);
    expect(result.advisoryPackages).toBe(1);
    expect(result.deprecated).toBe(1);
    // left-pad is clean, so it never reaches the risk list.
    expect(result.risks.map((r) => r.name)).toEqual(['lodash', 'request']);
  });

  it('never counts an untracked transitive as clean', async () => {
    // Nothing indexed: `tracked` is 0 and no risk is claimed either way.
    const db = stubDb([]);
    const result = await computeTransitiveDrift(db, resolved, direct, false);
    expect(result.tracked).toBe(0);
    expect(result.advisoryPackages).toBe(0);
    expect(result.risks).toEqual([]);
  });

  it('carries the exact resolved version, not a range guess', async () => {
    const db = stubDb([
      { name: 'lodash', latestVersion: '4.17.21', deprecated: false, advisories: [{ id: 'a' }] },
    ]);
    const result = await computeTransitiveDrift(db, resolved, direct, false);
    expect(result.risks[0]).toMatchObject({ version: '4.17.20', latest: '4.17.21' });
  });

  it('ranks advisories above deprecation', async () => {
    const db = stubDb([
      { name: 'request', latestVersion: '2.88.2', deprecated: true, advisories: [] },
      { name: 'lodash', latestVersion: '4.17.21', deprecated: false, advisories: [{ id: 'a' }] },
    ]);
    const result = await computeTransitiveDrift(db, resolved, direct, false);
    expect(result.risks[0]!.name).toBe('lodash');
  });

  it('propagates truncation so a partial tree never reads as complete', async () => {
    const db = stubDb([]);
    expect((await computeTransitiveDrift(db, resolved, direct, true)).truncated).toBe(true);
  });
});
