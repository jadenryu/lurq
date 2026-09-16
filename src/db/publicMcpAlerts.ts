/**
 * Public MCP endpoint changes, routed to the accounts that depend on them.
 *
 * The probe watches every remote endpoint in the registry, owner-blind. An
 * account depends on one of those endpoints in two ways, and either is enough:
 *
 *   - it runs the server: some `lurq mcp-scan` it uploaded included it, which
 *     is recorded as a deployment whose `server_key` equals the endpoint's
 *     `scan_key`. No action needed; the scan it already ran is the subscription.
 *   - it pinned the server: an explicit approval of the contract and sign-in
 *     path as they were, so "approved" keeps meaning what was approved.
 *
 * The change row is shared; acknowledging it is per account.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Severity } from '../audit/types';
import type { Database } from './client';
import {
  mcpDeployments,
  mcpEndpointChangeAcks,
  mcpEndpointChanges,
  mcpPins,
  mcpRemoteEndpoints,
  type McpEndpointChangeRow,
  type McpPinRow,
  type McpRemoteEndpointRow,
} from './schema';

export interface OwnerPublicChange {
  ownerId: string;
  changeId: number;
  endpointId: number;
  url: string;
  kind: McpEndpointChangeRow['kind'];
  severity: Severity;
  summary: string;
  diff: unknown;
  createdAt: Date;
  /** How the account depends on the endpoint; a pin wins when both apply. */
  via: 'pin' | 'deployment';
  /** What the account calls the server: its config alias, or the host. */
  label: string;
}

/**
 * Unacknowledged public changes since `since`, fanned out to every account that
 * depends on the endpoint. Pass `ownerId` to read one account's.
 */
export async function publicChangesForOwners(
  db: Database,
  since: Date,
  opts: { ownerId?: string; limit?: number } = {},
): Promise<OwnerPublicChange[]> {
  const limit = opts.limit ?? 5_000;
  const base = {
    changeId: mcpEndpointChanges.id,
    endpointId: mcpEndpointChanges.endpointId,
    url: mcpRemoteEndpoints.url,
    host: mcpRemoteEndpoints.host,
    kind: mcpEndpointChanges.kind,
    severity: mcpEndpointChanges.severity,
    summary: mcpEndpointChanges.summary,
    diff: mcpEndpointChanges.diff,
    createdAt: mcpEndpointChanges.createdAt,
  };
  const unacked = (ownerCol: typeof mcpDeployments.ownerId | typeof mcpPins.ownerId) =>
    sql`not exists (select 1 from ${mcpEndpointChangeAcks} a where a.owner_id = ${ownerCol} and a.change_id = ${mcpEndpointChanges.id})`;

  const [viaDeployment, viaPin] = await Promise.all([
    db
      .select({ ...base, ownerId: mcpDeployments.ownerId, alias: mcpDeployments.alias })
      .from(mcpEndpointChanges)
      .innerJoin(mcpRemoteEndpoints, eq(mcpRemoteEndpoints.id, mcpEndpointChanges.endpointId))
      .innerJoin(mcpDeployments, eq(mcpDeployments.serverKey, mcpRemoteEndpoints.scanKey))
      .where(
        and(
          gte(mcpEndpointChanges.createdAt, since),
          opts.ownerId ? eq(mcpDeployments.ownerId, opts.ownerId) : undefined,
          unacked(mcpDeployments.ownerId),
        ),
      )
      .limit(limit),
    db
      .select({ ...base, ownerId: mcpPins.ownerId })
      .from(mcpEndpointChanges)
      .innerJoin(mcpRemoteEndpoints, eq(mcpRemoteEndpoints.id, mcpEndpointChanges.endpointId))
      .innerJoin(mcpPins, and(eq(mcpPins.endpointId, mcpEndpointChanges.endpointId), isNull(mcpPins.removedAt)))
      .where(
        and(
          gte(mcpEndpointChanges.createdAt, since),
          opts.ownerId ? eq(mcpPins.ownerId, opts.ownerId) : undefined,
          unacked(mcpPins.ownerId),
        ),
      )
      .limit(limit),
  ]);

  const out = new Map<string, OwnerPublicChange>();
  const put = (r: (typeof viaPin)[number] & { alias?: string }, via: OwnerPublicChange['via']) => {
    const key = `${r.ownerId}:${r.changeId}`;
    const existing = out.get(key);
    if (existing && existing.via === 'pin') return;
    out.set(key, {
      ownerId: r.ownerId,
      changeId: r.changeId,
      endpointId: r.endpointId,
      url: r.url,
      kind: r.kind,
      severity: r.severity,
      summary: r.summary,
      diff: r.diff,
      createdAt: r.createdAt,
      via,
      label: existing?.label ?? r.alias ?? r.host,
    });
  };
  for (const r of viaDeployment) put(r, 'deployment');
  for (const r of viaPin) put(r, 'pin');
  return [...out.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Rebuild routed changes from (change, account) pairs, for delivery retries.
 * A pair whose change is gone, or whose account no longer depends on the
 * endpoint, is dropped: nobody is retried an alert they stopped subscribing to.
 */
export async function loadPublicChanges(db: Database, pairs: { changeId: number; ownerId: string }[]): Promise<OwnerPublicChange[]> {
  if (pairs.length === 0) return [];
  const rows = await db
    .select({
      changeId: mcpEndpointChanges.id,
      endpointId: mcpEndpointChanges.endpointId,
      url: mcpRemoteEndpoints.url,
      host: mcpRemoteEndpoints.host,
      scanKey: mcpRemoteEndpoints.scanKey,
      kind: mcpEndpointChanges.kind,
      severity: mcpEndpointChanges.severity,
      summary: mcpEndpointChanges.summary,
      diff: mcpEndpointChanges.diff,
      createdAt: mcpEndpointChanges.createdAt,
    })
    .from(mcpEndpointChanges)
    .innerJoin(mcpRemoteEndpoints, eq(mcpRemoteEndpoints.id, mcpEndpointChanges.endpointId))
    .where(inArray(mcpEndpointChanges.id, [...new Set(pairs.map((p) => p.changeId))]));
  const byId = new Map(rows.map((r) => [r.changeId, r]));
  const owners = [...new Set(pairs.map((p) => p.ownerId))];
  const [pins, deployments] = await Promise.all([
    db
      .select({ ownerId: mcpPins.ownerId, endpointId: mcpPins.endpointId })
      .from(mcpPins)
      .where(and(inArray(mcpPins.ownerId, owners), isNull(mcpPins.removedAt))),
    db
      .select({ ownerId: mcpDeployments.ownerId, serverKey: mcpDeployments.serverKey, alias: mcpDeployments.alias })
      .from(mcpDeployments)
      .where(inArray(mcpDeployments.ownerId, owners)),
  ]);

  const out: OwnerPublicChange[] = [];
  for (const { changeId, ownerId } of pairs) {
    const r = byId.get(changeId);
    if (!r) continue;
    const pinned = pins.some((p) => p.ownerId === ownerId && p.endpointId === r.endpointId);
    const deployment = deployments.find((d) => d.ownerId === ownerId && r.scanKey !== null && d.serverKey === r.scanKey);
    if (!pinned && !deployment) continue;
    const { host, scanKey: _scanKey, ...change } = r;
    out.push({ ...change, ownerId, via: pinned ? 'pin' : 'deployment', label: deployment?.alias ?? host });
  }
  return out;
}

/** Which of these public changes one account has acknowledged. */
export async function acknowledgedChangeIds(db: Database, ownerId: string, changeIds: number[]): Promise<Set<number>> {
  if (changeIds.length === 0) return new Set();
  const rows = await db
    .select({ changeId: mcpEndpointChangeAcks.changeId })
    .from(mcpEndpointChangeAcks)
    .where(and(eq(mcpEndpointChangeAcks.ownerId, ownerId), inArray(mcpEndpointChangeAcks.changeId, changeIds)));
  return new Set(rows.map((r) => r.changeId));
}

/** Does a public change with this id exist? Acknowledging a missing one is a 404, not a foreign-key error. */
export async function publicChangeExists(db: Database, changeId: number): Promise<boolean> {
  const [row] = await db.select({ id: mcpEndpointChanges.id }).from(mcpEndpointChanges).where(eq(mcpEndpointChanges.id, changeId)).limit(1);
  return Boolean(row);
}

/** One account's live pin on an endpoint, measured against what the probe reads now. */
export async function getPin(db: Database, ownerId: string, endpointId: number): Promise<PinStatus | null> {
  return (await listPins(db, ownerId)).find((p) => p.endpoint.id === endpointId) ?? null;
}

/** Mark a public change seen by one account. Idempotent. */
export async function acknowledgePublicChange(db: Database, ownerId: string, changeId: number): Promise<void> {
  await db.insert(mcpEndpointChangeAcks).values({ ownerId, changeId }).onConflictDoNothing();
}

/**
 * Pin an endpoint as it is now. Re-pinning an existing pin moves it to the
 * current contract, which is how an account approves a change it reviewed.
 */
export async function pinEndpoint(db: Database, ownerId: string, endpointId: number, note: string | null = null): Promise<McpPinRow | null> {
  const [endpoint] = await db
    .select({ contentHash: mcpRemoteEndpoints.lastContentHash, authHash: mcpRemoteEndpoints.lastAuthHash })
    .from(mcpRemoteEndpoints)
    .where(eq(mcpRemoteEndpoints.id, endpointId))
    .limit(1);
  if (!endpoint) return null;
  const now = new Date();
  const [row] = await db
    .insert(mcpPins)
    .values({ ownerId, endpointId, contentHash: endpoint.contentHash, authHash: endpoint.authHash, note, pinnedAt: now })
    .onConflictDoUpdate({
      target: [mcpPins.ownerId, mcpPins.endpointId],
      set: { contentHash: endpoint.contentHash, authHash: endpoint.authHash, note: note ?? sql`${mcpPins.note}`, pinnedAt: now, removedAt: null },
    })
    .returning();
  return row ?? null;
}

/** Stop watching a pinned endpoint. The pin row stays, marked removed. */
export async function unpinEndpoint(db: Database, ownerId: string, endpointId: number): Promise<boolean> {
  const rows = await db
    .update(mcpPins)
    .set({ removedAt: new Date() })
    .where(and(eq(mcpPins.ownerId, ownerId), eq(mcpPins.endpointId, endpointId), isNull(mcpPins.removedAt)))
    .returning({ id: mcpPins.id });
  return rows.length > 0;
}

export interface PinStatus {
  pin: McpPinRow;
  endpoint: Pick<McpRemoteEndpointRow, 'id' | 'url' | 'lastStatus' | 'lastProbedAt' | 'lastContentHash' | 'lastAuthHash'>;
  /** The contract the public probe reads now differs from the pinned one. */
  contractChanged: boolean;
  /** How a client signs in differs from the pinned sign-in path. */
  authChanged: boolean;
  openChanges: number;
  worstOpen: Severity | null;
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

/** An account's live pins, each measured against what the probe reads now. */
export async function listPins(db: Database, ownerId: string): Promise<PinStatus[]> {
  const rows = await db
    .select({
      pin: mcpPins,
      endpoint: {
        id: mcpRemoteEndpoints.id,
        url: mcpRemoteEndpoints.url,
        lastStatus: mcpRemoteEndpoints.lastStatus,
        lastProbedAt: mcpRemoteEndpoints.lastProbedAt,
        lastContentHash: mcpRemoteEndpoints.lastContentHash,
        lastAuthHash: mcpRemoteEndpoints.lastAuthHash,
      },
    })
    .from(mcpPins)
    .innerJoin(mcpRemoteEndpoints, eq(mcpRemoteEndpoints.id, mcpPins.endpointId))
    .where(and(eq(mcpPins.ownerId, ownerId), isNull(mcpPins.removedAt)))
    .orderBy(desc(mcpPins.pinnedAt));
  if (rows.length === 0) return [];

  const open = await db
    .select({ endpointId: mcpEndpointChanges.endpointId, severity: mcpEndpointChanges.severity, createdAt: mcpEndpointChanges.createdAt })
    .from(mcpEndpointChanges)
    .where(
      and(
        inArray(mcpEndpointChanges.endpointId, rows.map((r) => r.endpoint.id)),
        sql`not exists (select 1 from ${mcpEndpointChangeAcks} a where a.owner_id = ${ownerId} and a.change_id = ${mcpEndpointChanges.id})`,
      ),
    );

  return rows.map(({ pin, endpoint }) => {
    const mine = open.filter((c) => c.endpointId === endpoint.id && c.createdAt >= pin.pinnedAt);
    const worst = mine.reduce<Severity | null>((w, c) => (!w || RANK[c.severity] < RANK[w] ? c.severity : w), null);
    return {
      pin,
      endpoint,
      contractChanged: Boolean(pin.contentHash && endpoint.lastContentHash && pin.contentHash !== endpoint.lastContentHash),
      authChanged: Boolean(pin.authHash && endpoint.lastAuthHash && pin.authHash !== endpoint.lastAuthHash),
      openChanges: mine.length,
      worstOpen: worst,
    };
  });
}
