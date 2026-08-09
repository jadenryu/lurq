import { describe, it, expect } from 'vitest';
import { installKey, queryVulnerableInstalls } from '../src/ingestion/sources/osv';

/** A fetch stub returning one OSV `querybatch` response per call. */
function stubFetch(handler: (body: { queries: { version: string; package: { name: string } }[] }) => unknown) {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(handler(body)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('queryVulnerableInstalls', () => {
  it('reports only the versions OSV actually matched', async () => {
    const fetchImpl = stubFetch((body) => ({
      // Positional: one result per query, in order.
      results: body.queries.map((q) =>
        q.version === '4.17.20' ? { vulns: [{ id: 'GHSA-old' }] } : {},
      ),
    }));

    const { affected, complete } = await queryVulnerableInstalls(
      [
        { name: 'lodash', version: '4.17.20' },
        { name: 'lodash', version: '4.17.21' },
      ],
      fetchImpl,
    );

    expect(complete).toBe(true);
    expect(affected.get(installKey('lodash', '4.17.20'))).toEqual(['GHSA-old']);
    // The patched install is absent — the whole point. A package-level count
    // would have flagged both.
    expect(affected.has(installKey('lodash', '4.17.21'))).toBe(false);
  });

  it('dedupes repeated installs before asking', async () => {
    let queried = 0;
    const fetchImpl = stubFetch((body) => {
      queried += body.queries.length;
      return { results: body.queries.map(() => ({})) };
    });

    await queryVulnerableInstalls(
      [
        { name: 'tslib', version: '2.6.2' },
        { name: 'tslib', version: '2.6.2' },
        { name: 'tslib', version: '2.6.2' },
      ],
      fetchImpl,
    );
    expect(queried).toBe(1);
  });

  it('refuses to align a response of the wrong length', async () => {
    // A short result array would otherwise shift every id onto the wrong
    // package — attributing a real vulnerability to an innocent dependency.
    const fetchImpl = stubFetch(() => ({ results: [{ vulns: [{ id: 'GHSA-x' }] }] }));
    const { affected, complete } = await queryVulnerableInstalls(
      [
        { name: 'a', version: '1.0.0' },
        { name: 'b', version: '2.0.0' },
      ],
      fetchImpl,
    );
    expect(complete).toBe(false);
    expect(affected.size).toBe(0);
  });

  it('reports incompleteness rather than throwing', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const { affected, complete } = await queryVulnerableInstalls(
      [{ name: 'a', version: '1.0.0' }],
      fetchImpl,
    );
    // A scan must survive OSV being unreachable, but it must not then claim the
    // tree is clean.
    expect(complete).toBe(false);
    expect(affected.size).toBe(0);
  });

  it('is a no-op on an empty tree', async () => {
    const { affected, complete } = await queryVulnerableInstalls([]);
    expect(complete).toBe(true);
    expect(affected.size).toBe(0);
  });
});
