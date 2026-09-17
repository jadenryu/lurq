/**
 * A public endpoint change followed through every delivery path, against
 * Postgres: urgent candidates, the agent notice, retry rebuilds for email and
 * channels, and acknowledgement. Only touches rows this run created.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeResult } from '../src/remoteProbe/types';

const TEST_DB = process.env.LURQ_TEST_DATABASE_URL;
const WEB = 'https://lurq.run';

describe.skipIf(!TEST_DB)('public MCP changes through notify', () => {
  const run = randomUUID().slice(0, 8);
  const host = `${run}.notify-public.example`;
  const url = `https://mcp.${host}/mcp`;
  const serverName = `io.test.notify-public-${run}/srv`;
  const owner = `test_notifypub_${run}_owner`;
  const bystander = `test_notifypub_${run}_other`;
  let db: import('../src/db/client').Database;
  let close: () => Promise<void>;
  let sql: typeof import('drizzle-orm').sql;
  let endpointId: number;
  let changeId: number;

  const result = (over: Partial<ProbeResult> = {}): ProbeResult => ({
    url, status: 'auth_required', httpStatus: 401, transport: 'streamable-http', protocolMode: null, protocolVersion: null,
    serverName: null, serverVersion: null, auth: { mode: 'oauth', challengeStatus: 401, oauth: null, declaredHeaders: [] },
    violations: [], snapshot: null, error: null, latencyMs: 40, finalUrl: null, ...over,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    const { createDb } = await import('../src/db/client');
    ({ sql } = await import('drizzle-orm'));
    const store = await import('../src/db/remoteEndpoints');
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
    await db.insert(mcpDeployments).values({
      ownerId: owner, serverKey: serverKeyFor('remote', null, url, 'x'), configFingerprint: 'fp', alias: 'billing',
      registry: 'remote', packageName: null, transport: 'http', lastStatus: 'ok',
    });

    await store.recordEndpointProbe(db, {
      endpointId, result: result(), contentHash: null, authHash: 'auth-v2', contract: null, consecutiveFailures: 0, nextProbeAt: new Date(),
      changes: [
        { kind: 'auth', fromKey: 'auth-v1', toKey: 'auth-v2', severity: 'high', summary: 'Dynamic Client Registration no longer offered; clients that register that way will fail' },
        { kind: 'contract', fromKey: 'c1', toKey: 'c2', severity: 'low', summary: '1 tool(s) added' },
      ],
    });
    const rows = await db.execute(sql`select id, kind from mcp_endpoint_changes where endpoint_id = ${endpointId} order by id`);
    changeId = Number(([...rows] as { id: number; kind: string }[]).find((r) => r.kind === 'auth')!.id);
  });

  afterAll(async () => {
    // Local test database only: remove exactly the rows this run created.
    await db.execute(sql`delete from mcp_endpoint_change_acks where owner_id like ${`test_notifypub_${run}_%`}`);
    await db.execute(sql`delete from mcp_deployments where owner_id like ${`test_notifypub_${run}_%`}`);
    await db.execute(sql`delete from mcp_endpoint_changes where endpoint_id = ${endpointId}`);
    await db.execute(sql`delete from mcp_endpoint_observations where endpoint_id = ${endpointId}`);
    await db.execute(sql`delete from mcp_endpoint_servers where endpoint_id = ${endpointId}`);
    await db.execute(sql`delete from mcp_remote_endpoints where id = ${endpointId}`);
    await db.execute(sql`delete from mcp_registry_servers where name = ${serverName}`);
    await close();
  });

  it('makes only the high change urgent, for the account that runs the server', async () => {
    const { urgentCandidates } = await import('../src/notify/sources');
    const byOwner = await urgentCandidates(db, new Date(), WEB);
    expect(byOwner.get(bystander)).toBeUndefined();
    const mine = (byOwner.get(owner) ?? []).filter((i) => i.kind === 'mcp_public_change');
    expect(mine).toEqual([
      expect.objectContaining({
        key: `pub:${changeId}:${owner}`,
        title: 'billing changed how clients sign in since your last scan',
        url: `${WEB}/dashboard/mcp/public/${endpointId}`,
      }),
    ]);
  });

  it('tells the account’s agents, and sends both changes to channels at their severity', async () => {
    const { agentAlertNotice } = await import('../src/notify/sources');
    const notice = await agentAlertNotice(db, owner, new Date(), WEB);
    expect(notice).toMatch(/billing changed how clients sign in/);
    const { channelCandidates } = await import('../src/notify/channelSources');
    const items = ((await channelCandidates(db, new Date(), WEB)).get(owner) ?? []).filter((i) => i.key.startsWith('pub:'));
    expect(items.map((i) => i.severity).sort()).toEqual(['high', 'low']);
  });

  it('rebuilds items from their keys for retries, and drops them for accounts that no longer depend on the server', async () => {
    const { loadUrgentItems } = await import('../src/notify/sources');
    const { loadChannelItems } = await import('../src/notify/channelSources');
    const key = `pub:${changeId}:${owner}`;
    expect((await loadUrgentItems(db, [key], WEB)).map((i) => i.key)).toEqual([key]);
    expect((await loadChannelItems(db, [key], WEB)).map((i) => i.key)).toEqual([key]);
    expect(await loadUrgentItems(db, [`pub:${changeId}:${bystander}`], WEB)).toEqual([]);
  });

  it('stops alerting once the account acknowledges the change', async () => {
    const { acknowledgePublicChange } = await import('../src/db/publicMcpAlerts');
    await acknowledgePublicChange(db, owner, changeId);
    const { agentAlertNotice } = await import('../src/notify/sources');
    expect(await agentAlertNotice(db, owner, new Date(), WEB)).toBeNull();
  });
});
