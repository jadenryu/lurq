/**
 * The publish feed must see the version it was told about.
 *
 * The registry packument is cached for hours, so a re-sync triggered by a
 * publish used to read the copy from before that publish. These tests pin both
 * halves: the cached read really does hide the new release (the bug), and a
 * `fresh` read returns it and refreshes the cache for everyone after.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetHttpStateForTests } from '../../src/core/http';
import { fetchNpmRegistry } from '../../src/ingestion/sources/npmRegistry';

const CACHE_DIR = join(tmpdir(), 'lurq-registry-fresh-test');

function packument(latest: string) {
  return {
    name: 'left-pad',
    'dist-tags': { latest },
    versions: { [latest]: { name: 'left-pad', version: latest } },
    time: { created: '2020-01-01T00:00:00.000Z', [latest]: '2026-09-15T00:00:00.000Z' },
  };
}

/** A registry whose `latest` can be moved between calls, like a real publish. */
function registry() {
  const state = { latest: '1.0.0', calls: 0 };
  const fetchImpl = (async () => {
    state.calls++;
    const body = JSON.stringify(packument(state.latest));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { state, fetchImpl };
}

beforeEach(async () => {
  __resetHttpStateForTests();
  // The disk cache outlives the in-memory reset; clear it so each test starts cold.
  await rm(CACHE_DIR, { recursive: true, force: true });
  process.env.LURQ_CACHE_DIR = CACHE_DIR;
});

afterAll(async () => {
  await rm(CACHE_DIR, { recursive: true, force: true });
});

describe('fetchNpmRegistry after a publish', () => {
  it('a cached read hides the release that just landed', async () => {
    const { state, fetchImpl } = registry();
    expect((await fetchNpmRegistry('left-pad', fetchImpl)).latestVersion).toBe('1.0.0');

    state.latest = '2.0.0';
    const stale = await fetchNpmRegistry('left-pad', fetchImpl);

    expect(stale.latestVersion).toBe('1.0.0');
    expect(state.calls).toBe(1);
  });

  it('a fresh read returns it, and refreshes the cache for later reads', async () => {
    const { state, fetchImpl } = registry();
    await fetchNpmRegistry('left-pad', fetchImpl);

    state.latest = '2.0.0';
    const fresh = await fetchNpmRegistry('left-pad', fetchImpl, { fresh: true });
    expect(fresh.latestVersion).toBe('2.0.0');
    expect(state.calls).toBe(2);

    // The next ordinary read is served from the refreshed cache, not the network.
    const after = await fetchNpmRegistry('left-pad', fetchImpl);
    expect(after.latestVersion).toBe('2.0.0');
    expect(state.calls).toBe(2);
  });
});
