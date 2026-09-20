import { describe, it, expect, vi, beforeEach } from 'vitest';

// `usage` returned the whole surface in one response (react@19: ~266 symbols,
// ~8k tokens) and reported lodash's two-name DefinitelyTyped shell as its API.
vi.mock('../src/ingestion/sources', () => ({
  npmVersionExists: vi.fn().mockResolvedValue(true),
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
}));

import type { ExportSymbol } from '../src/core/types';
import { handleUsage, USAGE_PAGE_SIZE } from '../src/mcp/handlers';
import * as service from '../src/usage/service';

const getOrExtractSurface = vi.mocked(service.getOrExtractSurface);
const db = {} as never;

const fn = (name: string): ExportSymbol => ({ name, kind: 'function', signature: '() => void' });
const big = Array.from({ length: 200 }, (_, i) => fn(`sym${String(i).padStart(3, '0')}`));

describe('usage paging', () => {
  beforeEach(() => getOrExtractSurface.mockResolvedValue(big));

  it('caps the first page and says how to get the rest', async () => {
    const res = await handleUsage(db, { package: 'react', version: '19.0.0' });
    expect(res.surface).toHaveLength(USAGE_PAGE_SIZE);
    expect(res.totalSymbols).toBe(200);
    expect(res.note).toContain(`offset: ${USAGE_PAGE_SIZE}`);
  });

  it('serves a later page and marks the last one', async () => {
    const res = await handleUsage(db, { package: 'react', version: '19.0.0', offset: 160 });
    expect(res.surface?.[0]?.name).toBe('sym160');
    expect(res.surface).toHaveLength(40);
    expect(res.note).toContain('last page');
  });

  it('filters by name fragment, case-insensitively', async () => {
    const res = await handleUsage(db, { package: 'react', version: '19.0.0', query: 'SYM19' });
    expect(res.surface?.map((s) => s.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `sym19${i}`),
    );
    expect(res.totalSymbols).toBe(10);
    expect(res.note).toBeUndefined();
  });

  it('says so when the filter matches nothing', async () => {
    const res = await handleUsage(db, { package: 'react', version: '19.0.0', query: 'nope' });
    expect(res.surface).toEqual([]);
    expect(res.note).toContain('No exported symbol name contains "nope"');
  });

  it('adds no note to a surface that fits in one page', async () => {
    getOrExtractSurface.mockResolvedValue([fn('a'), fn('b')]);
    const res = await handleUsage(db, { package: 'tiny', version: '1.0.0' });
    expect(res.note).toBeUndefined();
    expect(res.shallow).toBeUndefined();
  });

  it('pages the answer but diffs the whole surface', async () => {
    getOrExtractSurface.mockImplementation(async (_db, _n, v) =>
      v === '18.0.0' ? [...big, fn('zzzRemoved')] : big,
    );
    const res = await handleUsage(db, {
      package: 'react',
      version: '19.0.0',
      knownVersion: '18.0.0',
    });
    expect(res.delta?.removed.map((s) => s.name)).toEqual(['zzzRemoved']);
  });
});

describe('usage shallow surfaces', () => {
  it("flags lodash's `export =` + interface shell and points at its declarations", async () => {
    getOrExtractSurface.mockResolvedValue([
      { name: 'default', kind: 'variable', signature: '_.LoDashStatic' },
      { name: 'LoDashStatic', kind: 'interface', signature: null },
    ]);
    const res = await handleUsage(db, { package: 'lodash', version: '4.17.21' });
    expect(res.shallow).toBe(true);
    expect(res.note).toContain('@types/lodash');
    expect(res.note).toContain('NOT listed');
  });

  it('does not flag a package whose only export is a default function', async () => {
    getOrExtractSurface.mockResolvedValue([
      { name: 'default', kind: 'function', signature: '(s: string) => string' },
    ]);
    const res = await handleUsage(db, { package: 'left-pad', version: '1.3.0' });
    expect(res.shallow).toBeUndefined();
  });
});
