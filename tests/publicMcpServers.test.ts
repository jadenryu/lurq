/**
 * Public MCP server summaries against Postgres, through a real express app:
 * which servers get a page, what the page carries, and what it never carries.
 * Only touches rows this run created.
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validRegistryName } from '../src/mcp/publicMcpServers';
import { emptySnapshot } from '../src/mcpScan/snapshot';
import type { ProbeResult } from '../src/remoteProbe/types';

vi.mock('../src/surface/mcpRegistry', async (orig) => ({
  ...(await orig<typeof import('../src/surface/mcpRegistry')>()),
  fetchServerManifest: vi.fn(async () => null),
}));

describe('validRegistryName', () => {
  it('accepts registry names and nothing that could smuggle a path or query', () => {
    expect(validRegistryName('io.github.acme/weather-mcp')).toBe(true);
    expect(validRegistryName('ai.adramp/google-ads')).toBe(true);
    expect(validRegistryName('weather')).toBe(false);
    expect(validRegistryName('a/b/c')).toBe(false);
    expect(validRegistryName('../etc/passwd')).toBe(false);
    expect(validRegistryName('io.x/y?z=1')).toBe(false);
  });
});

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('public MCP server pages against Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const host = `${run}.public-mcp.example`;
  const probed = `io.test.public-${run}/weather`;
  const unprobed = `io.test.public-${run}/quiet`;
  const deleted = `io.test.public-${run}/gone`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let sql: typeof import('drizzle-orm').sql;
  let server: Server;
  let base = '';

  const result = (over: Partial<ProbeResult> = {}): ProbeResult => ({
    url: 'x', status: 'open', httpStatus: 200, transport: 'streamable-http', protocolMode: 'stateless', protocolVersion: '2026-07-28',
    serverName: null, serverVersion: null, auth: { mode: 'none', challengeStatus: null, oauth: null, declaredHeaders: [] },
    violations: [], snapshot: null, error: null, latencyMs: 60, finalUrl: null, ...over,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    ({ sql } = await import('drizzle-orm'));
    const store = await import('../src/db/remoteEndpoints');
    const { contractRow } = await import('../src/remoteProbe/changes');
    const { registerPublicMcpServerRoutes } = await import('../src/mcp/publicMcpServers');
    const handle = createDb({ max: 4 });
    db = handle.db;
    close = handle.close;

    const entry = (name: string, url: string, status = 'active') => ({
      name, version: '2.1.0', title: 'Weather', description: 'Forecasts for anywhere', websiteUrl: null, repositoryUrl: 'https://github.com/acme/weather',
      remotes: [{ type: 'streamable-http', url }], packages: [], status, isLatest: true, publishedAt: null, updatedAt: new Date(),
    });
    await store.storeRegistryEntries(db, [entry(probed, `https://w.${host}/mcp`), entry(unprobed, `https://q.${host}/mcp`), entry(deleted, `https://g.${host}/mcp`)]);

    const snap = { ...emptySnapshot(), tools: [
      { name: 'forecast', description: 'secret prose', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } },
    ] };
    const row = contractRow(snap);
    const ep = (await store.getEndpointByUrl(db, `https://w.${host}/mcp`))!;
    await store.recordEndpointProbe(db, { endpointId: ep.id, result: result({ snapshot: snap }), contentHash: row.contentHash, authHash: 'none', contract: row, changes: [], consecutiveFailures: 0, nextProbeAt: new Date() });
    const gone = (await store.getEndpointByUrl(db, `https://g.${host}/mcp`))!;
    await store.recordEndpointProbe(db, { endpointId: gone.id, result: result(), contentHash: null, authHash: 'none', contract: null, changes: [], consecutiveFailures: 0, nextProbeAt: new Date() });
    await store.storeRegistryEntries(db, [entry(deleted, `https://g.${host}/mcp`, 'deleted')]);

    const app = express();
    registerPublicMcpServerRoutes(app, db, (_req: Request, _res: Response, next: NextFunction) => next());
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    // Local test database only: remove exactly the rows this run created.
    const ids = sql`(select id from mcp_remote_endpoints where host like ${`%.${host}`})`;
    await db.execute(sql`delete from mcp_endpoint_changes where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_endpoint_observations where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_endpoint_servers where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_remote_endpoints where host like ${`%.${host}`}`);
    await db.execute(sql`delete from mcp_registry_servers where name like ${`io.test.public-${run}/%`}`);
    await close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves a probed server as a cacheable summary with verdicts and tool names only', async () => {
    const res = await fetch(`${base}/public/mcp-server?name=${encodeURIComponent(probed)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=86400/);
    const body = (await res.json()) as Record<string, unknown> & { clients: { verdict: string }[]; summary: Record<string, number> };
    expect(body).toMatchObject({
      name: probed,
      version: '2.1.0',
      description: 'Forecasts for anywhere',
      endpoint: { url: `https://w.${host}/mcp`, status: 'open', authMode: 'none', toolNames: ['forecast'] },
      otherEndpoints: 0,
    });
    expect(body.clients.length).toBeGreaterThanOrEqual(21);
    expect(body.summary.works).toBeGreaterThan(0);
    const text = JSON.stringify(body);
    expect(text).not.toContain('secret prose');
    expect(text).not.toContain('inputSchema');
  });

  it('gives no page to an unprobed server, a deleted one, or a name that is not a registry name', async () => {
    expect((await fetch(`${base}/public/mcp-server?name=${encodeURIComponent(unprobed)}`)).status).toBe(404);
    expect((await fetch(`${base}/public/mcp-server?name=${encodeURIComponent(deleted)}`)).status).toBe(404);
    expect((await fetch(`${base}/public/mcp-server?name=weather`)).status).toBe(400);
  });

  it('lists only servers with a live probed endpoint', async () => {
    const body = (await (await fetch(`${base}/public/mcp-servers`)).json()) as { servers: { name: string; dataAsOf: string | null }[] };
    const mine = body.servers.filter((s) => s.name.startsWith(`io.test.public-${run}/`));
    expect(mine.map((s) => s.name)).toEqual([probed]);
    expect(mine[0]!.dataAsOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
