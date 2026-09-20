/**
 * The whole remote contract pipeline against Postgres and a real HTTP server:
 * registry sync → lease → probe → contract store → change event → reschedule,
 * then an incremental re-sync. Runs only with LURQ_TEST_DATABASE_URL and only
 * touches rows this run created.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __resetHttpStateForTests } from '../src/core/http';
import { createSafeFetch, publicHttpsOnly } from '../src/core/safeFetch';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('remote contract pipeline end to end', () => {
  const run = randomUUID().slice(0, 8);
  const serverName = `io.test.pipeline-${run}/tools`;
  let server: Server;
  let base: string;
  let tools = ['search', 'fetch'];
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let sql: typeof import('drizzle-orm').sql;
  const registryCalls: URL[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = req.url ?? '';
        if (url === `/open-${run}`) {
          const rpc = JSON.parse(body || '{}') as { id?: number };
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                tools: tools.map((name) => ({
                  name,
                  description: `${name} the corpus`,
                  inputSchema: {
                    type: 'object',
                    properties: { q: { type: 'string' } },
                    required: ['q'],
                  },
                  annotations: { readOnlyHint: true },
                })),
              },
            }),
          );
        }
        if (url === `/secure-${run}`) {
          res.writeHead(401, {
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/secure-${run}"`,
          });
          return res.end();
        }
        if (url === `/.well-known/oauth-protected-resource/secure-${run}`) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(
            JSON.stringify({
              resource: `${base}/secure-${run}`,
              authorization_servers: [`${base}/as`],
            }),
          );
        }
        if (url === '/.well-known/oauth-authorization-server/as') {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(
            JSON.stringify({
              issuer: `${base}/as`,
              registration_endpoint: `${base}/as/r`,
              code_challenge_methods_supported: ['S256'],
            }),
          );
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    ({ sql } = await import('drizzle-orm'));
    const handle = createDb({ max: 6 });
    db = handle.db;
    close = handle.close;
  });

  afterAll(async () => {
    // Local test database only: remove exactly the rows this run created.
    const ids = sql`(select endpoint_id from mcp_endpoint_servers where server_name = ${serverName})`;
    await db.execute(sql`delete from mcp_endpoint_changes where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_endpoint_observations where endpoint_id in ${ids}`);
    const endpointIds = await db.execute(
      sql`select endpoint_id from mcp_endpoint_servers where server_name = ${serverName}`,
    );
    await db.execute(sql`delete from mcp_endpoint_servers where server_name = ${serverName}`);
    for (const row of endpointIds)
      await db.execute(
        sql`delete from mcp_remote_endpoints where id = ${(row as { endpoint_id: number }).endpoint_id}`,
      );
    await db.execute(sql`delete from mcp_registry_servers where name = ${serverName}`);
    await db.execute(sql`delete from watch_state where id = ${`test-${run}`}`);
    await close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const registryFetch = (async (input: string | URL) => {
    const url = new URL(input.toString());
    registryCalls.push(url);
    const body = {
      servers: [
        {
          server: {
            name: serverName,
            version: '1.0.0',
            remotes: [
              { type: 'streamable-http', url: `${base}/open-${run}` },
              {
                type: 'streamable-http',
                url: `${base}/secure-${run}`,
                headers: [{ name: 'Authorization', isRequired: false, isSecret: true }],
              },
            ],
          },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              status: 'active',
              isLatest: true,
              updatedAt: '2026-09-10T10:00:00Z',
            },
          },
        },
      ],
      metadata: {},
    };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  const probeFetch = createSafeFetch({
    policy: (url) => (url.origin === base ? undefined : publicHttpsOnly(url)),
    lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
      o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) as never,
  });

  it('syncs the registry, probes both endpoints, and records a contract change on the next pass', async () => {
    __resetHttpStateForTests();
    const syncMod = await import('../src/registry/sync');
    const { drainRemoteProbes } = await import('../src/remoteProbe/drain');
    const store = await import('../src/db/remoteEndpoints');
    const { getWatchCursor } = await import('../src/db/watch');

    // A private cursor id keeps this run from moving the real watermark.
    const cursorId = `test-${run}`;
    expect(syncMod.REGISTRY_CURSOR_ID).toBe('mcp-registry:updated_since');

    const first = await syncMod.syncRegistry(db, { fetchImpl: registryFetch, cursorId });
    expect(first).toMatchObject({ pages: 1, versions: 1, endpointsLinked: 2 });

    const linked = await store.getEndpointsForServer(db, serverName);
    const ours = new Set(linked.map((l) => l.endpoint.id));
    expect(ours.size).toBe(2);

    // Scoped to this run's endpoints: test files share the database and run in
    // parallel, and an unscoped drain would probe another file's rows.
    const t1 = new Date(Date.now() + 60_000);
    const d1 = await drainRemoteProbes(db, {
      fetch: probeFetch,
      limit: 500,
      now: () => t1,
      budgetMs: 10_000,
      onlyIds: [...ours],
    });
    expect(d1.failed).toBe(0);

    const open = (await store.getEndpointByUrl(db, `${base}/open-${run}`))!;
    expect(open).toMatchObject({
      lastStatus: 'open',
      probeCount: 1,
      protocolMode: 'stateless',
      leaseUntil: null,
    });
    expect(open.lastContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(open.nextProbeAt.getTime()).toBeGreaterThan(t1.getTime() + 20 * 3_600_000);

    const secure = (await store.getEndpointByUrl(db, `${base}/secure-${run}`))!;
    expect(secure.lastStatus).toBe('auth_required');
    expect(secure.auth).toMatchObject({
      mode: 'oauth',
      oauth: { issuer: `${base}/as`, dcr: true, cimd: false, pkceS256: true },
    });
    expect(secure.auth!.declaredHeaders).toEqual([
      expect.objectContaining({ name: 'Authorization', secret: true }),
    ]);

    // The server drops a tool; the next probe (forced due) records the change.
    tools = ['search'];
    const t2 = new Date(open.nextProbeAt.getTime() + 60_000);
    await drainRemoteProbes(db, {
      fetch: probeFetch,
      limit: 500,
      now: () => t2,
      budgetMs: 10_000,
      onlyIds: [...ours],
    });
    const changed = (await store.getEndpointByUrl(db, `${base}/open-${run}`))!;
    expect(changed.lastContentHash).not.toBe(open.lastContentHash);
    expect(changed.lastChangedAt).toEqual(t2);
    const events = await store.listEndpointChanges(db, changed.id);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'contract',
        fromKey: open.lastContentHash,
        toKey: changed.lastContentHash,
      }),
    ]);
    expect(events[0]!.summary).toMatch(/removed/);
    expect(
      (events[0]!.diff as { contract: { removedTools: string[] } }).contract.removedTools,
    ).toEqual(['fetch']);
    // Recently changed endpoints are looked at again sooner.
    expect(changed.nextProbeAt.getTime() - t2.getTime()).toBeLessThan(8 * 3_600_000);

    // Incremental re-sync asks only for what changed since the held-back watermark.
    const watermark = await getWatchCursor(db, cursorId);
    expect(watermark).toBe('2026-09-10T09:59:59.000Z');
    await syncMod.syncRegistry(db, { fetchImpl: registryFetch, cursorId });
    expect(registryCalls.at(-1)!.searchParams.get('updated_since')).toBe(
      '2026-09-10T09:59:59.000Z',
    );
    expect(ours).toEqual(
      new Set((await store.getEndpointsForServer(db, serverName)).map((l) => l.endpoint.id)),
    );
  });
});
