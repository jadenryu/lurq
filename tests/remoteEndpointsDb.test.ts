/**
 * The remote endpoint store against Postgres: registry reconciliation, the lease
 * queue under concurrency, and run-length encoded history. Runs only with
 * LURQ_TEST_DATABASE_URL, and only ever touches rows this run created.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistryEntry } from '../src/registry/official';
import type { ProbeResult } from '../src/remoteProbe/types';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('remote endpoint store against Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const host = (n: string) => `${n}-${run}.remote-test.example`;
  const name = (n: string) => `io.test.remote-${run}/${n}`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let store: typeof import('../src/db/remoteEndpoints');
  let sql: typeof import('drizzle-orm').sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    store = await import('../src/db/remoteEndpoints');
    ({ sql } = await import('drizzle-orm'));
    const handle = createDb({ max: 6 });
    db = handle.db;
    close = handle.close;
  });

  afterAll(async () => {
    // Local test database only: remove exactly the rows this run created.
    const ids = sql`(select id from mcp_remote_endpoints where host like ${`%-${run}.remote-test.example`})`;
    await db.execute(sql`delete from mcp_endpoint_changes where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_endpoint_observations where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_endpoint_servers where endpoint_id in ${ids}`);
    await db.execute(
      sql`delete from mcp_remote_endpoints where host like ${`%-${run}.remote-test.example`}`,
    );
    await db.execute(
      sql`delete from mcp_registry_servers where name like ${`io.test.remote-${run}/%`}`,
    );
    await close();
  });

  const entry = (
    over: Partial<RegistryEntry> & { name: string; version: string },
  ): RegistryEntry => ({
    title: null,
    description: null,
    websiteUrl: null,
    repositoryUrl: null,
    remotes: [],
    packages: [],
    status: 'active',
    isLatest: true,
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  });

  const result = (over: Partial<ProbeResult> = {}): ProbeResult => ({
    url: 'x',
    status: 'open',
    httpStatus: 200,
    transport: 'streamable-http',
    protocolMode: 'stateless',
    protocolVersion: '2026-07-28',
    serverName: 'fx',
    serverVersion: '1.0.0',
    auth: { mode: 'none', challengeStatus: null, oauth: null, declaredHeaders: [] },
    violations: [],
    snapshot: null,
    error: null,
    latencyMs: 120,
    finalUrl: null,
    ...over,
  });

  it('links endpoints from latest versions, deduplicating equivalent URLs', async () => {
    const a = name('weather');
    const stats = await store.storeRegistryEntries(db, [
      entry({ name: a, version: '1.0.0', isLatest: false }),
      entry({
        name: a,
        version: '1.1.0',
        remotes: [
          {
            type: 'streamable-http',
            url: `https://${host('a')}/mcp`,
            headers: [{ name: 'Authorization', isRequired: true, isSecret: true }],
          },
          { type: 'streamable-http', url: `HTTPS://${host('a').toUpperCase()}/mcp#x` },
        ],
      }),
    ]);
    expect(stats).toMatchObject({ versions: 2, endpointsLinked: 1, linksRemoved: 0 });
    const linked = await store.getEndpointsForServer(db, a);
    expect(linked).toHaveLength(1);
    expect(linked[0]!.endpoint.url).toBe(`https://${host('a')}/mcp`);
    expect(linked[0]!.headers).toEqual([expect.objectContaining({ name: 'Authorization' })]);
    expect((await store.findRegistryServers(db, a)).map((s) => s.version)).toEqual(['1.1.0']);
  });

  it('marks links and orphaned endpoints removed when a new version drops a URL, without deleting', async () => {
    const b = name('drops');
    await store.storeRegistryEntries(db, [
      entry({
        name: b,
        version: '1.0.0',
        remotes: [
          { type: 'sse', url: `https://${host('b1')}/sse` },
          { type: 'streamable-http', url: `https://${host('b2')}/mcp` },
        ],
      }),
    ]);
    const stats = await store.storeRegistryEntries(db, [
      entry({
        name: b,
        version: '2.0.0',
        remotes: [{ type: 'streamable-http', url: `https://${host('b2')}/mcp` }],
      }),
    ]);
    expect(stats).toMatchObject({ linksRemoved: 1, endpointsRemoved: 1 });
    expect((await store.getEndpointsForServer(db, b)).map((l) => l.endpoint.host)).toEqual([
      host('b2'),
    ]);
    const gone = await store.getEndpointByUrl(db, `https://${host('b1')}/sse`);
    expect(gone?.removedAt).toBeInstanceOf(Date);
    expect((await store.findRegistryServers(db, b)).map((s) => s.version)).toEqual(['2.0.0']);

    // A deleted server drops every link.
    const del = await store.storeRegistryEntries(db, [
      entry({ name: b, version: '2.0.0', status: 'deleted' }),
    ]);
    expect(del).toMatchObject({ linksRemoved: 1, endpointsRemoved: 1 });
  });

  it('never hands the same endpoint to two concurrent claims, and re-offers an expired lease', async () => {
    const c = name('queue');
    await store.storeRegistryEntries(db, [
      entry({
        name: c,
        version: '1.0.0',
        remotes: Array.from({ length: 6 }, (_, i) => ({
          type: 'streamable-http',
          url: `https://${host(`q${i}`)}/mcp`,
        })),
      }),
    ]);
    const mine = new Set((await store.getEndpointsForServer(db, c)).map((l) => l.endpoint.id));
    const now = new Date(Date.now() + 60_000);
    const [x, y] = await Promise.all([
      store.claimDueEndpoints(db, { limit: 500, now, onlyIds: [...mine] }),
      store.claimDueEndpoints(db, { limit: 500, now, onlyIds: [...mine] }),
    ]);
    const ours = (rows: { id: number }[]) => rows.map((r) => r.id).filter((id) => mine.has(id));
    expect(ours(x).filter((id) => ours(y).includes(id))).toEqual([]);
    expect(new Set([...ours(x), ...ours(y)]).size).toBe(6);

    const again = await store.claimDueEndpoints(db, { limit: 500, now, onlyIds: [...mine] });
    expect(ours(again)).toEqual([]);
    const later = await store.claimDueEndpoints(db, {
      limit: 500,
      now: new Date(now.getTime() + 11 * 60_000),
      onlyIds: [...mine],
    });
    expect(ours(later).sort()).toEqual([...mine].sort());
  });

  it('run-length encodes identical probes, re-arms a change, and keeps the last contract through a failure', async () => {
    const d = name('history');
    await store.storeRegistryEntries(db, [
      entry({
        name: d,
        version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: `https://${host('h')}/mcp` }],
      }),
    ]);
    const ep = (await store.getEndpointsForServer(db, d))[0]!.endpoint;
    const base = {
      endpointId: ep.id,
      authHash: 'auth-none',
      contract: null,
      consecutiveFailures: 0,
      nextProbeAt: new Date(Date.now() + 86_400_000),
    };

    await store.recordEndpointProbe(db, {
      ...base,
      result: result(),
      contentHash: 'c1',
      changes: [],
    });
    await store.recordEndpointProbe(db, {
      ...base,
      result: result(),
      contentHash: 'c1',
      changes: [],
    });
    const obs = await db.execute(
      sql`select status, content_hash, probe_count from mcp_endpoint_observations where endpoint_id = ${ep.id} order by id`,
    );
    expect([...obs]).toEqual([{ status: 'open', content_hash: 'c1', probe_count: 2 }]);

    const change = {
      kind: 'contract' as const,
      fromKey: 'c1',
      toKey: 'c2',
      severity: 'moderate' as const,
      summary: 'tool removed',
    };
    await store.recordEndpointProbe(db, {
      ...base,
      result: result(),
      contentHash: 'c2',
      changes: [change],
    });
    await store.recordEndpointProbe(db, {
      ...base,
      result: result(),
      contentHash: 'c2',
      changes: [{ ...change, severity: 'high' }],
    });
    const changes = await store.listEndpointChanges(db, ep.id);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ severity: 'high', fromKey: 'c1', toKey: 'c2' });

    await store.recordEndpointProbe(db, {
      ...base,
      result: result({
        status: 'server_error',
        httpStatus: 503,
        error: 'HTTP 503',
        auth: { mode: 'unknown', challengeStatus: null, oauth: null, declaredHeaders: [] },
      }),
      contentHash: null,
      authHash: null,
      changes: [],
      consecutiveFailures: 1,
    });
    const after = (await store.getEndpointByUrl(db, `https://${host('h')}/mcp`))!;
    expect(after).toMatchObject({
      lastStatus: 'server_error',
      lastContentHash: 'c2',
      lastAuthHash: 'auth-none',
      consecutiveFailures: 1,
      probeCount: 5,
      leaseUntil: null,
    });
    expect(after.auth).toMatchObject({ mode: 'none' });
  });
});
