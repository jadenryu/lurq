/**
 * The `_changes` follower re-syncs a tracked package with a fresh registry read.
 * Without `fresh` the re-sync can read a packument cached from before the
 * publish it is reacting to (see tests/ingestion/npmRegistryFresh.test.ts).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/pipeline/single', () => ({ syncOnePackage: vi.fn() }));
vi.mock('../src/db/packages', () => ({ getAllPackageNames: vi.fn(async () => ['left-pad']) }));
vi.mock('../src/db/discovery', () => ({
  enqueueCandidates: vi.fn(async () => 0),
  getQueuedNames: vi.fn(async () => new Set<string>()),
}));
vi.mock('../src/db/surface', () => ({
  enqueueSurface: vi.fn(async () => undefined),
  getMcpServerNames: vi.fn(async () => []),
}));
vi.mock('../src/db/watch', () => ({
  getWatchCursor: vi.fn(async () => '100'),
  setWatchCursor: vi.fn(async () => undefined),
}));

import * as single from '../src/pipeline/single';
import { watchNpmChanges } from '../src/pipeline/watch';

describe('watchNpmChanges', () => {
  it('re-syncs a tracked publish with fresh: true', async () => {
    const controller = new AbortController();
    const syncOnePackage = vi.mocked(single.syncOnePackage);
    // Stop the follower as soon as the first re-sync happens.
    syncOnePackage.mockImplementation(async () => {
      controller.abort();
      return {} as never;
    });

    const page = { results: [{ seq: 101, id: 'left-pad', deleted: false }], last_seq: 101 };
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => page,
    })) as unknown as typeof fetch;

    await watchNpmChanges({} as never, { signal: controller.signal, fetchImpl });

    expect(syncOnePackage).toHaveBeenCalledWith({}, 'left-pad', { fresh: true });
  });

  it('once: returns at the head instead of idling', async () => {
    vi.mocked(single.syncOnePackage).mockResolvedValue({} as never);
    const page = { results: [{ seq: 102, id: 'left-pad', deleted: false }], last_seq: 102 };
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => page,
    })) as unknown as typeof fetch;

    // No abort signal: without `once` this would sleep 30s and poll forever.
    await watchNpmChanges({} as never, { fetchImpl, once: true });
  });

  it('once: returns on a feed error so cron can retry', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await watchNpmChanges({} as never, { fetchImpl, once: true });
  });
});
