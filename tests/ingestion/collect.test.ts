import { describe, it, expect, beforeEach } from 'vitest';
import { __resetHttpStateForTests } from '../../src/core/http';
import { collectSignals } from '../../src/ingestion/collect';

function makeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Route requests to fixtures by URL substring; github 404s to prove isolation. */
const router = (async (url: string) => {
  if (url.includes('registry.npmjs.org')) {
    return makeResponse(200, {
      name: 'react',
      'dist-tags': { latest: '18.3.1' },
      description: 'UI library',
      repository: { url: 'git+https://github.com/facebook/react.git' },
      time: { created: '2013-05-29T00:00:00Z', '18.3.1': '2024-04-25T00:00:00Z' },
      versions: { '18.3.1': {} },
    });
  }
  if (url.includes('api.npmjs.org/downloads/point')) return makeResponse(200, { downloads: 1_000_000 });
  if (url.includes('api.npmjs.org/downloads/range')) return makeResponse(200, { downloads: [] });
  if (url.includes('api.github.com/graphql')) return makeResponse(404, { message: 'no' });
  if (url.includes('api.deps.dev/v3/projects')) {
    return makeResponse(200, { scorecard: { overallScore: 7 } });
  }
  if (url.includes('api.deps.dev/v3/systems')) return makeResponse(200, { advisoryKeys: [] });
  return makeResponse(404, {});
}) as unknown as typeof fetch;

beforeEach(() => __resetHttpStateForTests());

describe('collectSignals (fault isolation)', () => {
  it('gathers signals and isolates a single source failure', async () => {
    const signals = await collectSignals('react', 'orm', {
      githubToken: 'tok',
      fetchImpl: router,
    });

    // Healthy sources came through.
    expect(signals.registry?.name).toBe('react');
    expect(signals.downloads?.weeklyDownloads).toBe(1_000_000);
    expect(signals.depsDev?.scorecard).toBe(7);

    // GitHub failed (404) but was isolated — recorded, not thrown.
    expect(signals.github).toBeNull();
    expect(signals.errors.some((e) => e.source === 'github')).toBe(true);

    // 'orm' is a backend category → bundlephobia skipped without a request.
    expect(signals.bundle?.bundleMinGzipKb).toBeNull();
  });
});
