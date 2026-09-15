/**
 * connect_check end to end against Postgres: registry data and recorded probes
 * in, per-client verdicts and config out. The registry lookup for npm names is
 * mocked so nothing here reaches the network except a local test server.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aliasFor } from '../src/connect/check';
import { createSafeFetch, publicHttpsOnly } from '../src/core/safeFetch';
import { emptySnapshot } from '../src/mcpScan/snapshot';
import type { ProbeResult } from '../src/remoteProbe/types';

vi.mock('../src/surface/mcpRegistry', async (orig) => ({
  ...(await orig<typeof import('../src/surface/mcpRegistry')>()),
  fetchServerManifest: vi.fn(async () => null),
}));

describe('aliasFor', () => {
  it('derives the config key a user would choose', () => {
    expect(aliasFor('io.github.acme/weather-mcp')).toBe('weather');
    expect(aliasFor('@acme/github-mcp-server')).toBe('github');
    expect(aliasFor('https://mcp.linear.app/mcp')).toBe('mcp');
    expect(aliasFor('Some Odd/Name!!')).toBe('name');
    expect(aliasFor('x'.repeat(80))).toHaveLength(30);
  });
});

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('handleConnectCheck against Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const host = `${run}.connect-test.example`;
  const name = `io.test.connect-${run}/weather`;
  const keyName = `io.test.connect-${run}/keyed`;
  const openUrl = `https://open.${host}/mcp`;
  const oauthUrl = `https://auth.${host}/mcp`;
  const keyUrl = `https://key.${host}/mcp`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let sql: typeof import('drizzle-orm').sql;
  let check: typeof import('../src/connect/check');
  let local: Server;
  let localBase: string;

  const probe = (over: Partial<ProbeResult>): ProbeResult => ({
    url: 'x',
    status: 'open',
    httpStatus: 200,
    transport: 'streamable-http',
    protocolMode: 'stateless',
    protocolVersion: '2026-07-28',
    serverName: null,
    serverVersion: null,
    auth: { mode: 'none', challengeStatus: null, oauth: null, declaredHeaders: [] },
    violations: [],
    snapshot: null,
    error: null,
    latencyMs: 90,
    finalUrl: null,
    ...over,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    ({ sql } = await import('drizzle-orm'));
    check = await import('../src/connect/check');
    const store = await import('../src/db/remoteEndpoints');
    const { contractRow } = await import('../src/remoteProbe/changes');
    const handle = createDb({ max: 4 });
    db = handle.db;
    close = handle.close;

    const entry = (n: string, remotes: { type: string; url: string; headers?: { name: string; isRequired?: boolean; isSecret?: boolean }[] }[]) => ({
      name: n, version: '1.0.0', title: null, description: null, websiteUrl: null, repositoryUrl: null, remotes,
      packages: [], status: 'active', isLatest: true, publishedAt: null, updatedAt: new Date('2026-09-01T00:00:00Z'),
    });
    await store.storeRegistryEntries(db, [
      entry(name, [{ type: 'streamable-http', url: oauthUrl }, { type: 'streamable-http', url: openUrl }]),
      entry(keyName, [{ type: 'streamable-http', url: keyUrl, headers: [{ name: 'X-API-Key', isRequired: true, isSecret: true }] }]),
    ]);

    const snap = { ...emptySnapshot(), tools: [
      { name: 'forecast', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
      { name: 'alerts', inputSchema: { type: 'object', properties: {} } },
    ] };
    const row = contractRow(snap);
    const record = async (url: string, result: ProbeResult, contract = false) => {
      const ep = (await store.getEndpointByUrl(db, url))!;
      await store.recordEndpointProbe(db, {
        endpointId: ep.id, result, contentHash: contract ? row.contentHash : null, authHash: result.auth.mode === 'unknown' ? null : `a-${result.auth.mode}`,
        contract: contract ? row : null, changes: [], consecutiveFailures: 0, nextProbeAt: new Date(Date.now() + 86_400_000),
      });
    };
    await record(openUrl, probe({ snapshot: snap }), true);
    await record(oauthUrl, probe({
      status: 'auth_required', httpStatus: 401, protocolMode: null,
      auth: { mode: 'oauth', challengeStatus: 401, declaredHeaders: [], oauth: {
        resourceMetadataUrl: `${oauthUrl}/.well-known`, resourceMetadataVia: 'www_authenticate', resource: oauthUrl, authorizationServers: [`https://id.${host}`],
        scopesSupported: null, challengeScope: null, issuer: `https://id.${host}`, asMetadataUrl: null, cimd: true, dcr: true, pkceS256: false, issParameter: null,
      } },
      violations: [{ code: 'pkce_s256_not_advertised', detail: 'no S256' }],
    }));
    await record(keyUrl, probe({ status: 'auth_required', httpStatus: 401, protocolMode: null, auth: { mode: 'static', challengeStatus: 401, oauth: null, declaredHeaders: [] }, violations: [{ code: 'challenge_without_resource_metadata', detail: 'no discovery' }] }));

    local = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const rpc = JSON.parse(body || '{}') as { id?: number };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] } }));
      });
    });
    await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
    localBase = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    // Local test database only: remove exactly the rows this run created.
    const ids = sql`(select id from mcp_remote_endpoints where host like ${`%.${host}`})`;
    await db.execute(sql`delete from mcp_endpoint_changes where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_endpoint_observations where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_endpoint_servers where endpoint_id in ${ids}`);
    await db.execute(sql`delete from mcp_remote_endpoints where host like ${`%.${host}`}`);
    await db.execute(sql`delete from mcp_registry_servers where name like ${`io.test.connect-${run}/%`}`);
    await close();
    await new Promise<void>((r) => local.close(() => r()));
  });

  it('resolves a registry name to its best endpoint and answers for every client', async () => {
    const r = await check.handleConnectCheck(db, { server: name });
    expect(r).toMatchObject({ resolvedAs: 'registry', server: { registryName: name, url: openUrl }, evidence: { source: 'probe', status: 'open', toolCount: 2 } });
    expect(r.clients.length).toBeGreaterThanOrEqual(21);
    const cc = r.clients.find((c) => c.client === 'claude-code')!;
    expect(cc).toMatchObject({ verdict: 'works', via: 'remote' });
    expect(JSON.parse(cc.config.find((x) => x.kind === 'json')!.text)).toEqual({ mcpServers: { weather: { type: 'http', url: openUrl } } });
    expect(Object.values(r.summary).reduce((a, b) => a + b, 0)).toBe(r.clients.length);
    expect(r.coverageNote).toMatch(/credential-free probe/);
  });

  it('blocks ChatGPT on a missing PKCE advertisement while Claude Code still works', async () => {
    const r = await check.handleConnectCheck(db, { server: oauthUrl });
    expect(r).toMatchObject({ resolvedAs: 'endpoint', evidence: { status: 'auth_required', auth: { mode: 'oauth', pkceS256: false } } });
    const chatgpt = r.clients.find((c) => c.client === 'chatgpt')!;
    expect(chatgpt.verdict).toBe('blocked');
    expect(chatgpt.blockers.map((b) => b.code)).toContain('pkce_required');
    expect(chatgpt.config).toEqual([]);
    const cc = r.clients.find((c) => c.client === 'claude-code')!;
    expect(cc.verdict).toBe('works');
    expect(cc.warnings.map((w) => w.code)).toContain('pkce_not_advertised');
  });

  it('asks for the declared key, rendering a placeholder, and narrows to one client on request', async () => {
    const r = await check.handleConnectCheck(db, { server: keyName, client: 'claude-code' });
    expect(r.clients).toHaveLength(1);
    const cc = r.clients[0]!;
    expect(cc.verdict).toBe('needs_setup');
    expect(cc.setup[0]!.detail).toMatch(/X-API-Key/);
    const cmd = cc.config.find((x) => x.kind === 'command')!.text;
    expect(cmd).toContain('--header "X-API-Key: <your-x-api-key>"');
  });

  it('probes an unseen URL live when allowed, and does not store it', async () => {
    const url = `${localBase}/private-${run}`;
    const fetch = createSafeFetch({
      policy: (u) => (u.origin === localBase ? undefined : publicHttpsOnly(u)),
      lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4))) as never,
    });
    const r = await check.handleConnectCheck(db, { server: url, client: 'claude-code' }, { liveProbe: { fetch } });
    expect(r).toMatchObject({ resolvedAs: 'url', evidence: { source: 'live_probe', status: 'open', toolCount: 1 } });
    expect(r.clients[0]!.verdict).toBe('works');
    const { getEndpointByUrl } = await import('../src/db/remoteEndpoints');
    expect(await getEndpointByUrl(db, url)).toBeNull();

    const withoutLive = await check.handleConnectCheck(db, { server: url, client: 'claude-code' });
    expect(withoutLive).toMatchObject({ evidence: { source: 'none', status: null } });
    expect(withoutLive.clients[0]!.verdict).toBe('unknown');
  });

  it('answers honestly for something it has never heard of', async () => {
    const r = await check.handleConnectCheck(db, { server: `nothing-${run}` });
    expect(r.resolvedAs).toBeNull();
    expect(r.summary.unknown).toBe(r.clients.length);
    expect(r.coverageNote).toMatch(/NOT evidence/);
  });
});
