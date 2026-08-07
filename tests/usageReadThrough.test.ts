/**
 * The `usage` read path is a read-through (§4D): a stored surface is served, a
 * miss extracts from the shipped `.d.ts` and stores it, and anything slower than
 * the budget degrades to the README-fallback note rather than stalling the call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/apiSurfaces', () => ({
  getStoredSurface: vi.fn(),
  upsertSurface: vi.fn(),
}));
vi.mock('../src/usage/extract', () => ({ extractSurface: vi.fn() }));

import { getOrExtractSurface, resetSurfaceInflight } from '../src/usage/service';
import { handleUsage } from '../src/mcp/handlers';
import * as surfaces from '../src/db/apiSurfaces';
import * as extract from '../src/usage/extract';
import type { ExportSymbol } from '../src/core/types';

const getStoredSurface = vi.mocked(surfaces.getStoredSurface);
const upsertSurface = vi.mocked(surfaces.upsertSurface);
const extractSurface = vi.mocked(extract.extractSurface);

const db = {} as never;
const sym = (name: string): ExportSymbol => ({ name, kind: 'function', signature: '(): void' });
const SURFACE = [sym('launch')];

/** A promise whose settlement this test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSurfaceInflight();
  upsertSurface.mockResolvedValue(undefined as never);
});

describe('getOrExtractSurface — read-through', () => {
  it('serves a stored surface without touching the CDN', async () => {
    getStoredSurface.mockResolvedValue(SURFACE);

    await expect(getOrExtractSurface(db, 'puppeteer', '24.14.0')).resolves.toEqual(SURFACE);
    expect(extractSurface).not.toHaveBeenCalled();
  });

  it('extracts and stores on a miss', async () => {
    getStoredSurface.mockResolvedValue(null);
    extractSurface.mockResolvedValue(SURFACE);

    const got = await getOrExtractSurface(db, 'puppeteer', '24.14.0', { budgetMs: 1000 });

    expect(got).toEqual(SURFACE);
    expect(upsertSurface).toHaveBeenCalledWith(db, 'puppeteer', '24.14.0', SURFACE);
  });

  it('returns null past the budget, but the extraction still warms the cache', async () => {
    getStoredSurface.mockResolvedValue(null);
    const slow = deferred<ExportSymbol[] | null>();
    extractSurface.mockReturnValue(slow.promise);

    // The budget elapses while the extraction is still in flight.
    await expect(getOrExtractSurface(db, 'puppeteer', '24.14.0', { budgetMs: 5 })).resolves.toBeNull();

    // Not cancelled: when it lands, the store still happens, so the *next*
    // request for this version is a cache hit.
    slow.resolve(SURFACE);
    await vi.waitFor(() =>
      expect(upsertSurface).toHaveBeenCalledWith(db, 'puppeteer', '24.14.0', SURFACE),
    );
  });

  it('collapses concurrent misses for the same version into one extraction', async () => {
    getStoredSurface.mockResolvedValue(null);
    const pending = deferred<ExportSymbol[] | null>();
    extractSurface.mockReturnValue(pending.promise);

    const both = Promise.all([
      getOrExtractSurface(db, 'puppeteer', '24.14.0', { budgetMs: 1000 }),
      getOrExtractSurface(db, 'puppeteer', '24.14.0', { budgetMs: 1000 }),
    ]);
    pending.resolve(SURFACE);

    expect(await both).toEqual([SURFACE, SURFACE]);
    expect(extractSurface).toHaveBeenCalledTimes(1);
    expect(upsertSurface).toHaveBeenCalledTimes(1);
  });

  it('skips extraction entirely at budgetMs 0 (cache-only)', async () => {
    getStoredSurface.mockResolvedValue(null);

    await expect(getOrExtractSurface(db, 'puppeteer', '24.14.0', { budgetMs: 0 })).resolves.toBeNull();
    expect(extractSurface).not.toHaveBeenCalled();
  });

  it('still returns the surface when the cache write fails', async () => {
    getStoredSurface.mockResolvedValue(null);
    extractSurface.mockResolvedValue(SURFACE);
    upsertSurface.mockRejectedValue(new Error('db is at its size limit'));

    await expect(
      getOrExtractSurface(db, 'puppeteer', '24.14.0', { budgetMs: 1000 }),
    ).resolves.toEqual(SURFACE);
  });

  it('degrades to null when the surface cannot be extracted', async () => {
    getStoredSurface.mockResolvedValue(null);
    extractSurface.mockResolvedValue(null); // untyped package, or no compiler installed

    await expect(getOrExtractSurface(db, 'left-pad', '1.3.0', { budgetMs: 1000 })).resolves.toBeNull();
    expect(upsertSurface).not.toHaveBeenCalled();
  });

  it('survives an extraction that throws', async () => {
    getStoredSurface.mockResolvedValue(null);
    extractSurface.mockRejectedValue(new Error('jsDelivr 502'));

    await expect(getOrExtractSurface(db, 'puppeteer', '24.14.0', { budgetMs: 1000 })).resolves.toBeNull();
  });
});

describe('handleUsage — first request populates the cache', () => {
  it('answers for a version that was never extracted before', async () => {
    getStoredSurface.mockResolvedValue(null);
    extractSurface.mockResolvedValue(SURFACE);

    const out = await handleUsage(db, { package: 'puppeteer', version: '24.14.0' });

    expect(out.available).toBe(true);
    expect(out.surface).toEqual(SURFACE);
    expect(out.note).toBeUndefined();
    expect(upsertSurface).toHaveBeenCalledWith(db, 'puppeteer', '24.14.0', SURFACE);
  });

  it('keeps the README-fallback note when extraction yields nothing', async () => {
    getStoredSurface.mockResolvedValue(null);
    extractSurface.mockResolvedValue(null);

    const out = await handleUsage(db, { package: 'left-pad', version: '1.3.0' });

    expect(out.available).toBe(false);
    expect(out.surface).toBeNull();
    expect(out.note).toMatch(/fall back to the README/);
  });

  it('read-throughs knownVersion too, so a delta needs neither version pre-warmed', async () => {
    getStoredSurface.mockResolvedValue(null);
    extractSurface.mockImplementation(async (_name: string, version: string) =>
      version === '21.11.0' ? [sym('launch'), sym('createBrowserFetcher')] : [sym('launch')],
    );

    const out = await handleUsage(db, {
      package: 'puppeteer',
      version: '24.14.0',
      knownVersion: '21.11.0',
    });

    expect(out.delta?.fromVersion).toBe('21.11.0');
    expect(out.delta?.removed.map((s) => s.name)).toEqual(['createBrowserFetcher']);
    expect(extractSurface).toHaveBeenCalledTimes(2);
  });

  it('does not report a delta it could not compute', async () => {
    getStoredSurface.mockResolvedValue(null);
    extractSurface.mockImplementation(async (_name: string, version: string) =>
      version === '24.14.0' ? SURFACE : null,
    );

    const out = await handleUsage(db, {
      package: 'puppeteer',
      version: '24.14.0',
      knownVersion: '21.11.0',
    });

    expect(out.available).toBe(true);
    expect(out.delta).toBeUndefined();
  });
});
