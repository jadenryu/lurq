import { beforeEach, describe, expect, it } from 'vitest';
import { __resetHttpStateForTests } from '../src/core/http';
import { listRegistry, parseRegistryItem } from '../src/registry/official';

const META = 'io.modelcontextprotocol.registry/official';

function item(over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
  return {
    server: {
      name: 'io.github.acme/weather',
      version: '1.2.0',
      description: 'Weather',
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://mcp.acme.dev/mcp',
          headers: [
            { name: 'Authorization', isRequired: true, isSecret: true, description: 'Bearer key' },
          ],
        },
      ],
      packages: [
        {
          registryType: 'npm',
          identifier: '@acme/weather-mcp',
          transport: { type: 'stdio' },
          environmentVariables: [{ name: 'ACME_KEY', isRequired: true, isSecret: true }],
        },
      ],
      ...over,
    },
    _meta: {
      [META]: {
        status: 'active',
        isLatest: true,
        publishedAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-06-01T12:00:00Z',
        ...meta,
      },
    },
  };
}

describe('parseRegistryItem', () => {
  it('keeps what the pipeline needs: remotes with headers, packages with env, lifecycle', () => {
    const e = parseRegistryItem(item())!;
    expect(e).toMatchObject({
      name: 'io.github.acme/weather',
      version: '1.2.0',
      status: 'active',
      isLatest: true,
    });
    expect(e.remotes[0]).toMatchObject({
      type: 'streamable-http',
      url: 'https://mcp.acme.dev/mcp',
    });
    expect(e.remotes[0]!.headers![0]).toMatchObject({
      name: 'Authorization',
      isRequired: true,
      isSecret: true,
    });
    expect(e.packages[0]!.environmentVariables![0]!.name).toBe('ACME_KEY');
    expect(e.updatedAt?.toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });

  it('reports deleted entries rather than dropping them', () => {
    expect(parseRegistryItem(item({}, { status: 'deleted', isLatest: false }))).toMatchObject({
      status: 'deleted',
      isLatest: false,
    });
  });

  it('rejects entries with no name or version, or absurd sizes', () => {
    expect(parseRegistryItem({ server: { version: '1' } })).toBeNull();
    expect(parseRegistryItem({ server: { name: 'x' } })).toBeNull();
    expect(parseRegistryItem(item({ description: 'x'.repeat(5_000) }))).toBeNull();
    expect(parseRegistryItem(null)).toBeNull();
  });

  it('tolerates missing or malformed metadata', () => {
    const e = parseRegistryItem({
      server: { name: 'a/b', version: '1' },
      _meta: { [META]: { updatedAt: 'not a date' } },
    })!;
    expect(e).toMatchObject({
      status: 'active',
      isLatest: false,
      updatedAt: null,
      remotes: [],
      packages: [],
    });
  });
});

describe('listRegistry', () => {
  beforeEach(() => __resetHttpStateForTests());

  function fakeFetch(pages: Record<string, unknown>) {
    const urls: string[] = [];
    const fn = (async (input: string | URL) => {
      const url = new URL(input.toString());
      urls.push(url.toString());
      const body = pages[url.searchParams.get('cursor') ?? ''];
      return new Response(JSON.stringify(body ?? { servers: [] }), { status: 200 });
    }) as typeof fetch;
    return { fn, urls };
  }

  it('follows the cursor, passes filters, and skips bad entries without failing the page', async () => {
    const { fn, urls } = fakeFetch({
      '': { servers: [item(), { server: { version: 'no-name' } }], metadata: { nextCursor: 'c1' } },
      c1: { servers: [item({ name: 'io.github.acme/other' })], metadata: {} },
    });
    const since = new Date('2026-09-01T00:00:00Z');
    const pages = [];
    for await (const p of listRegistry({
      updatedSince: since,
      version: 'latest',
      fetchImpl: fn,
      retries: 0,
    }))
      pages.push(p);

    expect(pages.map((p) => [p.entries.length, p.rejected, p.nextCursor])).toEqual([
      [1, 1, 'c1'],
      [1, 0, null],
    ]);
    const first = new URL(urls[0]!);
    expect(first.searchParams.get('updated_since')).toBe('2026-09-01T00:00:00.000Z');
    expect(first.searchParams.get('version')).toBe('latest');
    expect(first.searchParams.get('limit')).toBe('100');
    expect(new URL(urls[1]!).searchParams.get('cursor')).toBe('c1');
  });

  it('stops on a cursor that does not advance', async () => {
    const { fn, urls } = fakeFetch({
      '': { servers: [item()], metadata: { nextCursor: 'same' } },
      same: { servers: [item()], metadata: { nextCursor: 'same' } },
    });
    let n = 0;
    for await (const _ of listRegistry({ fetchImpl: fn, retries: 0 })) n++;
    expect(n).toBe(2);
    expect(urls).toHaveLength(2);
  });

  it('honours maxPages', async () => {
    const { fn } = fakeFetch({
      '': { servers: [item()], metadata: { nextCursor: 'a' } },
      a: { servers: [item()], metadata: { nextCursor: 'b' } },
    });
    let n = 0;
    for await (const _ of listRegistry({ fetchImpl: fn, retries: 0, maxPages: 1 })) n++;
    expect(n).toBe(1);
  });
});
