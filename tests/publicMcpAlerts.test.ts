/**
 * Routing public endpoint changes to the accounts that depend on them, against
 * Postgres: through a scan they already uploaded, or through an explicit pin.
 * Runs only with LURQ_TEST_DATABASE_URL and only touches rows this run created.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeResult } from '../src/remoteProbe/types';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('public MCP change routing', () => {
  const run = randomUUID().slice(0, 8);
  const host = `${run}.alerts-test.example`;
  const url = `https://mcp.${host}/mcp`;
  const serverName = `io.test.alerts-${run}/tools`;
  const scanner = `test_pubalert_${run}_scanner`;
  const pinner = `test_pubalert_${run}_pinner`;
  const both = `test_pubalert_${run}_both`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let sql: typeof import('drizzle-orm').sql;
  let alerts: typeof import('../src/db/publicMcpAlerts');
  let store: typeof import('../src/db/remoteEndpoints');
  let endpointId: number;

  const result = (over: Partial<ProbeResult> = {}): ProbeResult => ({
    url, status: 'open', httpStatus: 200, transport: 'streamable-http', protocolMode: 'stateless', protocolVersion: '2026-07-28',
    serverName: null, serverVersion: null, auth: { mode: 'none', challengeStatus: null, oauth: null, declaredHeaders: [] },
    violations: [], snapshot: null, error: null, latencyMs: 50, finalUrl: null, ...over,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    ({ sql } = await import('drizzle-orm'));
    alerts = await import('../src/db/publicMcpAlerts');
    store = await import('../src/db/remoteEndpoints');
    const { mcpDeployments } = await import('../src/db/schema');
    const { serverKeyFor } = await import('../src/mcpScan/config');
    const handle = createDb({ max: 4 });
    db = handle.db;
    close = handle.close;

    await store.storeRegistryEntries(db, [{
      name: serverName, version: '1.0.0', title: null, description: null, websiteUrl: null, repositoryUrl: null,
      remotes: [{ type: 'streamable-http', url }], packages: [], status: 'active', isLatest: true, publishedAt: null, updatedAt: new Date(),
    }]);
    endpointId = (await store.getEndpointByUrl(db, url))!.id;

    // Two accounts already run this server: their own mcp-scan recorded it under
    // the same key the registry sync computed. The query string an account's
    // config carries is dropped from the key, as the scanner does.
    const serverKey = serverKeyFor('remote', null, `${url}?token=abc`, 'x');
    for (const owner of [scanner, both]) {
      await db.insert(mcpDeployments).values({
        ownerId: owner, serverKey, configFingerprint: 'fp', alias: owner === scanner ? 'tools' : 'my-tools', registry: 'remote',
        packageName: null, transport: 'http', lastStatus: 'ok',
      });
    }
    await store.recordEndpointProbe(db, { endpointId, result: result(), contentHash: 'c1', authHash: 'a1', contract: null, changes: [], consecutiveFailures: 0, nextProbeAt: new Date() });
  });

  afterAll(async () => {
    // Local test database only: remove exactly the rows this run created.
    await db.execute(sql`delete from mcp_endpoint_change_acks where owner_id like ${`test_pubalert_${run}_%`}`);
    await db.execute(sql`delete from mcp_pins where owner_id like ${`test_pubalert_${run}_%`}`);
    await db.execute(sql`delete from mcp_deployments where owner_id like ${`test_pubalert_${run}_%`}`);
    await db.execute(sql`delete from mcp_endpoint_changes where endpoint_id = ${endpointId}`);
    await db.execute(sql`delete from mcp_endpoint_observations where endpoint_id = ${endpointId}`);
    await db.execute(sql`delete from mcp_endpoint_servers where endpoint_id = ${endpointId}`);
    await db.execute(sql`delete from mcp_remote_endpoints where id = ${endpointId}`);
    await db.execute(sql`delete from mcp_registry_servers where name = ${serverName}`);
    await close();
  });

  it('pins the contract and sign-in path as they are now', async () => {
    const pin = await alerts.pinEndpoint(db, pinner, endpointId, 'approved in review');
    expect(pin).toMatchObject({ ownerId: pinner, endpointId, contentHash: 'c1', authHash: 'a1', note: 'approved in review', removedAt: null });
    await alerts.pinEndpoint(db, both, endpointId);
    expect((await alerts.listPins(db, pinner))[0]).toMatchObject({ contractChanged: false, authChanged: false, openChanges: 0 });
  });

  it('routes a change to accounts that scanned the server and accounts that pinned it, once each', async () => {
    const since = new Date(Date.now() - 60_000);
    await store.recordEndpointProbe(db, {
      endpointId, result: result(), contentHash: 'c2', authHash: 'a1', contract: null, consecutiveFailures: 0, nextProbeAt: new Date(),
      changes: [{ kind: 'contract', fromKey: 'c1', toKey: 'c2', severity: 'high', summary: `${url}: 1 tool(s) removed` }],
    });
    const routed = await alerts.publicChangesForOwners(db, since);
    const mine = routed.filter((r) => r.ownerId.startsWith(`test_pubalert_${run}_`));
    expect(mine.map((r) => [r.ownerId, r.via, r.label]).sort()).toEqual(
      [
        [both, 'pin', 'my-tools'],
        [pinner, 'pin', `mcp.${host}`],
        [scanner, 'deployment', 'tools'],
      ].sort(),
    );
    expect(mine.every((r) => r.kind === 'contract' && r.severity === 'high')).toBe(true);

    const pins = await alerts.listPins(db, pinner);
    expect(pins[0]).toMatchObject({ contractChanged: true, authChanged: false, openChanges: 1, worstOpen: 'high' });
  });

  it('acknowledges per account, and re-pinning approves the change', async () => {
    const since = new Date(Date.now() - 60_000);
    const [change] = await alerts.publicChangesForOwners(db, since, { ownerId: scanner });
    await alerts.acknowledgePublicChange(db, scanner, change!.changeId);
    await alerts.acknowledgePublicChange(db, scanner, change!.changeId);
    expect(await alerts.publicChangesForOwners(db, since, { ownerId: scanner })).toEqual([]);
    expect(await alerts.publicChangesForOwners(db, since, { ownerId: pinner })).toHaveLength(1);

    await alerts.pinEndpoint(db, pinner, endpointId);
    expect((await alerts.listPins(db, pinner))[0]).toMatchObject({ contractChanged: false, pin: { contentHash: 'c2' } });
  });

  it('unpins softly and stops routing through the pin', async () => {
    expect(await alerts.unpinEndpoint(db, pinner, endpointId)).toBe(true);
    expect(await alerts.unpinEndpoint(db, pinner, endpointId)).toBe(false);
    expect(await alerts.listPins(db, pinner)).toEqual([]);
    const since = new Date(Date.now() - 60_000);
    expect(await alerts.publicChangesForOwners(db, since, { ownerId: pinner })).toEqual([]);
    const rows = await db.execute(sql`select removed_at from mcp_pins where owner_id = ${pinner}`);
    expect([...rows]).toHaveLength(1);
  });
});
