/**
 * Persistence for the remote contract pipeline: registry sync, the probe queue,
 * and the history every public answer about a remote endpoint is read from.
 *
 * Deliberately dumb. Deciding what changed, how bad it is and when to look again
 * lives in `remoteProbe/`, where it is pure and tested without a database; this
 * module writes those decisions atomically and reads them back.
 *
 * Nothing here deletes a row. A server that stops naming a URL marks the link
 * removed, and an endpoint no live link names is marked removed; the history of
 * what it was stays queryable.
 */
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Severity } from '../audit/types';
import type { RegistryEntry } from '../registry/official';
import type { DeclaredHeader, ProbeResult, Violation } from '../remoteProbe/types';
import { serverKeyFor } from '../mcpScan/config';
import { endpointIdentity } from '../remoteProbe/url';
import type { Database } from './client';
import {
  mcpContracts,
  mcpEndpointChanges,
  mcpEndpointObservations,
  mcpEndpointServers,
  mcpRegistryServers,
  mcpRemoteEndpoints,
  type McpEndpointChangeRow,
  type McpRegistryServerRow,
  type McpRemoteEndpointRow,
} from './schema';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// ── Registry sync ────────────────────────────────────────────────────────────

export interface RegistryStoreStats {
  versions: number;
  endpointsLinked: number;
  linksRemoved: number;
  endpointsRemoved: number;
}

/**
 * Store one page of registry entries and reconcile the endpoints their latest
 * versions name. Idempotent: replaying a page changes nothing but `synced_at`.
 */
export async function storeRegistryEntries(db: Database, entries: RegistryEntry[], now = new Date()): Promise<RegistryStoreStats> {
  const stats: RegistryStoreStats = { versions: 0, endpointsLinked: 0, linksRemoved: 0, endpointsRemoved: 0 };
  if (entries.length === 0) return stats;

  // The same name@version can repeat inside one page on a registry replay;
  // Postgres refuses to upsert one key twice in a statement.
  const versions = new Map(entries.map((e) => [`${e.name}@${e.version}`, e]));

  return db.transaction(async (tx) => {
    await tx
      .insert(mcpRegistryServers)
      .values(
        [...versions.values()].map((e) => ({
          name: e.name,
          version: e.version,
          title: e.title,
          description: e.description,
          websiteUrl: e.websiteUrl,
          repositoryUrl: e.repositoryUrl,
          status: e.status,
          isLatest: e.isLatest,
          remotes: e.remotes,
          packages: e.packages,
          publishedAt: e.publishedAt,
          registryUpdatedAt: e.updatedAt,
          syncedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [mcpRegistryServers.name, mcpRegistryServers.version],
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          websiteUrl: sql`excluded.website_url`,
          repositoryUrl: sql`excluded.repository_url`,
          status: sql`excluded.status`,
          isLatest: sql`excluded.is_latest`,
          remotes: sql`excluded.remotes`,
          packages: sql`excluded.packages`,
          publishedAt: sql`excluded.published_at`,
          registryUpdatedAt: sql`excluded.registry_updated_at`,
          syncedAt: now,
        },
      });
    stats.versions = versions.size;

    const latest = new Map<string, RegistryEntry>();
    for (const e of versions.values()) if (e.isLatest) latest.set(e.name, e);
    if (latest.size === 0) return stats;

    // A newer version is latest now, so any other version of the name is not.
    for (const e of latest.values()) {
      await tx
        .update(mcpRegistryServers)
        .set({ isLatest: false })
        .where(and(eq(mcpRegistryServers.name, e.name), sql`${mcpRegistryServers.version} <> ${e.version}`, eq(mcpRegistryServers.isLatest, true)));
    }

    // Endpoints named by live latest versions, deduplicated by canonical URL.
    const endpoints = new Map<string, { host: string; transport: string; templated: boolean }>();
    const wanted: { url: string; serverName: string; headers: RegistryEntry['remotes'][number]['headers'] }[] = [];
    for (const e of latest.values()) {
      if (e.status === 'deleted') continue;
      for (const r of e.remotes) {
        const id = endpointIdentity(r.url);
        if (!id) continue;
        endpoints.set(id.url, { host: id.host, transport: r.type, templated: id.templated });
        wanted.push({ url: id.url, serverName: e.name, headers: r.headers ?? [] });
      }
    }

    const idByUrl = new Map<string, number>();
    if (endpoints.size) {
      const rows = await tx
        .insert(mcpRemoteEndpoints)
        .values(
          [...endpoints].map(([url, v]) => ({
            url,
            host: v.host,
            transport: v.transport,
            templated: v.templated,
            scanKey: v.templated ? null : serverKeyFor('remote', null, url, ''),
          })),
        )
        .onConflictDoUpdate({
          target: mcpRemoteEndpoints.url,
          set: { transport: sql`excluded.transport`, templated: sql`excluded.templated`, scanKey: sql`excluded.scan_key`, removedAt: null },
        })
        .returning({ id: mcpRemoteEndpoints.id, url: mcpRemoteEndpoints.url });
      for (const r of rows) idByUrl.set(r.url, r.id);
    }

    // One server can list the same endpoint twice under spellings that canonicalize
    // together; its declared headers are the union, first declaration of a name wins.
    const links = new Map<string, { endpointId: number; serverName: string; headers: NonNullable<RegistryEntry['remotes'][number]['headers']> }>();
    for (const w of wanted) {
      const endpointId = idByUrl.get(w.url);
      if (endpointId === undefined) continue;
      const key = `${endpointId}:${w.serverName}`;
      const link = links.get(key) ?? { endpointId, serverName: w.serverName, headers: [] };
      for (const h of w.headers ?? []) {
        if (!link.headers.some((x) => x.name.toLowerCase() === h.name.toLowerCase())) link.headers.push(h);
      }
      links.set(key, link);
    }
    if (links.size) {
      await tx
        .insert(mcpEndpointServers)
        .values([...links.values()].map((l) => ({ ...l, lastSeenAt: now, removedAt: null })))
        .onConflictDoUpdate({
          target: [mcpEndpointServers.endpointId, mcpEndpointServers.serverName],
          set: { headers: sql`excluded.headers`, lastSeenAt: now, removedAt: null },
        });
    }
    stats.endpointsLinked = links.size;

    // Links these servers had before and no longer name.
    const keep = [...links.values()].map((l) => sql`(${l.endpointId}, ${l.serverName})`);
    const dropped = await tx
      .update(mcpEndpointServers)
      .set({ removedAt: now })
      .where(
        and(
          inArray(mcpEndpointServers.serverName, [...latest.keys()]),
          isNull(mcpEndpointServers.removedAt),
          keep.length
            ? sql`(${mcpEndpointServers.endpointId}, ${mcpEndpointServers.serverName}) not in (${sql.join(keep, sql`, `)})`
            : sql`true`,
        ),
      )
      .returning({ endpointId: mcpEndpointServers.endpointId });
    stats.linksRemoved = dropped.length;

    if (dropped.length) {
      const orphaned = await tx
        .update(mcpRemoteEndpoints)
        .set({ removedAt: now })
        .where(
          and(
            inArray(mcpRemoteEndpoints.id, [...new Set(dropped.map((d) => d.endpointId))]),
            isNull(mcpRemoteEndpoints.removedAt),
            sql`not exists (select 1 from ${mcpEndpointServers} l where l.endpoint_id = ${mcpRemoteEndpoints.id} and l.removed_at is null)`,
          ),
        )
        .returning({ id: mcpRemoteEndpoints.id });
      stats.endpointsRemoved = orphaned.length;
    }
    return stats;
  });
}

// ── Probe queue ──────────────────────────────────────────────────────────────

export interface ClaimedEndpoint {
  id: number;
  url: string;
  host: string;
  transport: string;
  lastStatus: McpRemoteEndpointRow['lastStatus'];
  lastContentHash: string | null;
  lastAuthHash: string | null;
  /** The last auth profile read, so an auth change can be described, not just detected. */
  auth: McpRemoteEndpointRow['auth'];
  consecutiveFailures: number;
  lastChangedAt: Date | null;
}

/** Declared headers per endpoint, merged across every live registry server naming it. */
export async function getDeclaredHeaders(db: Database, endpointIds: number[]): Promise<Map<number, DeclaredHeader[]>> {
  const out = new Map<number, DeclaredHeader[]>();
  if (endpointIds.length === 0) return out;
  const rows = await db
    .select({ endpointId: mcpEndpointServers.endpointId, headers: mcpEndpointServers.headers })
    .from(mcpEndpointServers)
    .where(and(inArray(mcpEndpointServers.endpointId, endpointIds), isNull(mcpEndpointServers.removedAt)));
  for (const r of rows) {
    const list = out.get(r.endpointId) ?? [];
    for (const h of r.headers ?? []) {
      if (list.some((x) => x.name.toLowerCase() === h.name.toLowerCase())) continue;
      list.push({ name: h.name, required: h.isRequired === true, secret: h.isSecret === true, description: h.description ?? null });
    }
    out.set(r.endpointId, list);
  }
  return out;
}

/**
 * Lease up to `limit` due endpoints. Rows another worker holds are skipped, not
 * waited on; a lease that is never released expires after `leaseMs`.
 */
export async function claimDueEndpoints(
  db: Database,
  opts: { limit: number; leaseMs?: number; now?: Date },
): Promise<ClaimedEndpoint[]> {
  const now = opts.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (opts.leaseMs ?? 10 * 60_000));
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: mcpRemoteEndpoints.id })
      .from(mcpRemoteEndpoints)
      .where(
        and(
          eq(mcpRemoteEndpoints.optedOut, false),
          eq(mcpRemoteEndpoints.templated, false),
          isNull(mcpRemoteEndpoints.removedAt),
          lte(mcpRemoteEndpoints.nextProbeAt, now),
          or(isNull(mcpRemoteEndpoints.leaseUntil), lt(mcpRemoteEndpoints.leaseUntil, now)),
        ),
      )
      .orderBy(asc(mcpRemoteEndpoints.nextProbeAt))
      .limit(opts.limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(mcpRemoteEndpoints)
      .set({ leaseUntil })
      .where(inArray(mcpRemoteEndpoints.id, due.map((d) => d.id)))
      .returning({
        id: mcpRemoteEndpoints.id,
        url: mcpRemoteEndpoints.url,
        host: mcpRemoteEndpoints.host,
        transport: mcpRemoteEndpoints.transport,
        lastStatus: mcpRemoteEndpoints.lastStatus,
        lastContentHash: mcpRemoteEndpoints.lastContentHash,
        lastAuthHash: mcpRemoteEndpoints.lastAuthHash,
        auth: mcpRemoteEndpoints.auth,
        consecutiveFailures: mcpRemoteEndpoints.consecutiveFailures,
        lastChangedAt: mcpRemoteEndpoints.lastChangedAt,
      });
  });
}

/** Give a lease back untouched, e.g. when a drain is interrupted before probing. */
export async function releaseEndpoints(db: Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(mcpRemoteEndpoints).set({ leaseUntil: null }).where(inArray(mcpRemoteEndpoints.id, ids));
}

export interface EndpointChangeInput {
  kind: McpEndpointChangeRow['kind'];
  fromKey: string;
  toKey: string;
  severity: Severity;
  summary: string;
  diff?: unknown;
}

export type NewMcpContract = typeof mcpContracts.$inferInsert;

export interface ProbeRecordInput {
  endpointId: number;
  result: ProbeResult;
  /** Set when the probe read a contract. */
  contentHash: string | null;
  authHash: string | null;
  contract: NewMcpContract | null;
  changes: EndpointChangeInput[];
  consecutiveFailures: number;
  nextProbeAt: Date;
  now?: Date;
}

const violationKey = (v: Violation[] | null | undefined) =>
  [...new Set((v ?? []).map((x) => x.code))].sort().join(',');

/** Write one probe's outcome atomically and release its lease. */
export async function recordEndpointProbe(db: Database, input: ProbeRecordInput): Promise<void> {
  const now = input.now ?? new Date();
  const r = input.result;
  await db.transaction(async (tx: Tx) => {
    if (input.contract) await tx.insert(mcpContracts).values(input.contract).onConflictDoNothing();

    const [last] = await tx
      .select()
      .from(mcpEndpointObservations)
      .where(eq(mcpEndpointObservations.endpointId, input.endpointId))
      .orderBy(desc(mcpEndpointObservations.firstSeenAt), desc(mcpEndpointObservations.id))
      .limit(1);
    const same =
      last &&
      last.status === r.status &&
      (last.contentHash ?? null) === input.contentHash &&
      (last.authHash ?? null) === input.authHash &&
      violationKey(last.violations) === violationKey(r.violations);
    if (same) {
      await tx
        .update(mcpEndpointObservations)
        .set({ probeCount: sql`${mcpEndpointObservations.probeCount} + 1`, lastSeenAt: now })
        .where(eq(mcpEndpointObservations.id, last.id));
    } else {
      await tx.insert(mcpEndpointObservations).values({
        endpointId: input.endpointId,
        status: r.status,
        httpStatus: r.httpStatus,
        contentHash: input.contentHash,
        authHash: input.authHash,
        violations: r.violations,
        protocolVersion: r.protocolVersion,
        error: r.error,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }

    for (const c of input.changes) {
      await tx
        .insert(mcpEndpointChanges)
        .values({ endpointId: input.endpointId, ...c, diff: c.diff ?? null, createdAt: now })
        .onConflictDoUpdate({
          target: [mcpEndpointChanges.endpointId, mcpEndpointChanges.kind, mcpEndpointChanges.fromKey, mcpEndpointChanges.toKey],
          set: { severity: c.severity, summary: c.summary, diff: c.diff ?? null, createdAt: now },
        });
    }

    await tx
      .update(mcpRemoteEndpoints)
      .set({
        lastStatus: r.status,
        lastHttpStatus: r.httpStatus,
        // A failed probe says nothing about the contract or auth: keep the last known.
        lastContentHash: input.contentHash ?? sql`${mcpRemoteEndpoints.lastContentHash}`,
        lastAuthHash: input.authHash ?? sql`${mcpRemoteEndpoints.lastAuthHash}`,
        auth: r.auth.mode === 'unknown' ? sql`${mcpRemoteEndpoints.auth}` : r.auth,
        violations: r.violations,
        protocolMode: r.protocolMode,
        protocolVersion: r.protocolVersion,
        serverName: r.serverName ?? sql`${mcpRemoteEndpoints.serverName}`,
        serverVersion: r.serverVersion ?? sql`${mcpRemoteEndpoints.serverVersion}`,
        finalUrl: r.finalUrl,
        latencyMs: r.latencyMs,
        lastError: r.error,
        consecutiveFailures: input.consecutiveFailures,
        probeCount: sql`${mcpRemoteEndpoints.probeCount} + 1`,
        lastProbedAt: now,
        lastChangedAt: input.changes.length ? now : sql`${mcpRemoteEndpoints.lastChangedAt}`,
        nextProbeAt: input.nextProbeAt,
        leaseUntil: null,
      })
      .where(eq(mcpRemoteEndpoints.id, input.endpointId));
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getEndpointByUrl(db: Database, raw: string): Promise<McpRemoteEndpointRow | null> {
  const id = endpointIdentity(raw);
  if (!id) return null;
  const [row] = await db.select().from(mcpRemoteEndpoints).where(eq(mcpRemoteEndpoints.url, id.url)).limit(1);
  return row ?? null;
}

export interface LinkedEndpoint {
  endpoint: McpRemoteEndpointRow;
  headers: McpRegistryServerRow['remotes'][number]['headers'];
}

/** The live endpoints a registry server names, with the headers it declares for each. */
export async function getEndpointsForServer(db: Database, serverName: string): Promise<LinkedEndpoint[]> {
  const rows = await db
    .select({ endpoint: mcpRemoteEndpoints, headers: mcpEndpointServers.headers })
    .from(mcpEndpointServers)
    .innerJoin(mcpRemoteEndpoints, eq(mcpRemoteEndpoints.id, mcpEndpointServers.endpointId))
    .where(and(eq(mcpEndpointServers.serverName, serverName), isNull(mcpEndpointServers.removedAt)))
    .orderBy(asc(mcpRemoteEndpoints.id));
  return rows;
}

/** Registry servers (latest version) a caller might mean: exact name, or a package identifier. */
export async function findRegistryServers(db: Database, query: string, limit = 5): Promise<McpRegistryServerRow[]> {
  const q = query.trim();
  if (!q) return [];
  return db
    .select()
    .from(mcpRegistryServers)
    .where(
      and(
        eq(mcpRegistryServers.isLatest, true),
        or(
          eq(mcpRegistryServers.name, q),
          sql`${mcpRegistryServers.packages} @> ${JSON.stringify([{ identifier: q }])}::jsonb`,
        ),
      ),
    )
    .orderBy(desc(mcpRegistryServers.registryUpdatedAt))
    .limit(limit);
}

export async function listEndpointChanges(db: Database, endpointId: number, limit = 10): Promise<McpEndpointChangeRow[]> {
  return db
    .select()
    .from(mcpEndpointChanges)
    .where(eq(mcpEndpointChanges.endpointId, endpointId))
    .orderBy(desc(mcpEndpointChanges.createdAt))
    .limit(limit);
}

/** Endpoint counts by last status, for the operator view. */
export async function endpointStatusCounts(db: Database): Promise<{ status: string; count: number }[]> {
  return db
    .select({ status: sql<string>`coalesce(${mcpRemoteEndpoints.lastStatus}, 'unprobed')`, count: sql<number>`count(*)::int` })
    .from(mcpRemoteEndpoints)
    .where(isNull(mcpRemoteEndpoints.removedAt))
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`));
}

/** A maintainer asked not to be probed: stop scheduling every endpoint on that host. */
export async function optOutHost(db: Database, host: string): Promise<number> {
  const rows = await db
    .update(mcpRemoteEndpoints)
    .set({ optedOut: true, leaseUntil: null })
    .where(eq(mcpRemoteEndpoints.host, host.trim().toLowerCase()))
    .returning({ id: mcpRemoteEndpoints.id });
  return rows.length;
}
