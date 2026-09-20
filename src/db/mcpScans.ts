/**
 * Storage for live MCP scans: owner-scoped history of what each deployment
 * exposed, change point by change point.
 *
 * Same authorization rule as db/repos and db/selectionPolicy: every read is
 * scoped by `ownerId`, and there is no unscoped one. A private server's tool
 * descriptions disclose what a company has built internally.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Severity } from '../audit/types';
import type { SnapshotDiff } from '../mcpScan/analyze';
import type { Registry } from '../mcpScan/config';
import type { ScanStatus } from '../mcpScan/errors';
import type { Database } from './client';
import {
  mcpChangeEvents,
  mcpContracts,
  mcpDeployments,
  mcpObservations,
  mcpPublicReports,
  type McpChangeEventRow,
  type McpContractRow,
  type McpDeploymentRow,
  type McpObservationRow,
} from './schema';

type NewContract = typeof mcpContracts.$inferInsert;

/** Insert a contract if it is new. Content-addressed, so a conflict is a no-op. */
export async function putContract(db: Database, row: NewContract): Promise<void> {
  await db.insert(mcpContracts).values(row).onConflictDoNothing();
}

export async function getContract(
  db: Database,
  contentHash: string,
): Promise<McpContractRow | null> {
  const [row] = await db
    .select()
    .from(mcpContracts)
    .where(eq(mcpContracts.contentHash, contentHash))
    .limit(1);
  return row ?? null;
}

export async function countDeployments(db: Database, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mcpDeployments)
    .where(eq(mcpDeployments.ownerId, ownerId));
  return row?.n ?? 0;
}

export async function deploymentExists(
  db: Database,
  ownerId: string,
  serverKey: string,
  configFingerprint: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: mcpDeployments.id })
    .from(mcpDeployments)
    .where(
      and(
        eq(mcpDeployments.ownerId, ownerId),
        eq(mcpDeployments.serverKey, serverKey),
        eq(mcpDeployments.configFingerprint, configFingerprint),
      ),
    )
    .limit(1);
  return !!row;
}

export interface ScanRecordInput {
  ownerId: string;
  serverKey: string;
  configFingerprint: string;
  alias: string;
  registry: Registry;
  packageName: string | null;
  transport: string;
  serverName: string | null;
  serverVersion: string | null;
  status: ScanStatus;
  error: string | null;
  /** Null when the contract was not read. */
  contentHash: string | null;
  worstSeverity: Severity | null;
  source: string;
}

export type ChangeKind = 'first' | 'unchanged' | 'changed' | 'status_changed';

export interface ScanRecordResult {
  deploymentId: number;
  change: ChangeKind;
  /** Present when the contract moved. */
  event: { at: Date; severity: Severity; summary: string; rugPull: string[] } | null;
}

/**
 * Record one server's scan: deployment, change-point observation, change event.
 *
 * One transaction, with the deployment row locked, because the same account
 * routinely scans the same deployment from two places at once (a laptop and a
 * scheduled CI job). Without the lock both read "last contract = A", both see
 * B, and the feed gets the same change twice — or the run-length counter loses
 * a scan.
 *
 * `diff` is called only when the contract actually moved, inside the lock, with
 * the previous contract row.
 */
export async function recordScan(
  db: Database,
  input: ScanRecordInput,
  diff: (previous: McpContractRow) => SnapshotDiff,
): Promise<ScanRecordResult> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const inserted = await tx
      .insert(mcpDeployments)
      .values({
        ownerId: input.ownerId,
        serverKey: input.serverKey,
        configFingerprint: input.configFingerprint,
        alias: input.alias,
        registry: input.registry,
        packageName: input.packageName,
        transport: input.transport,
        lastStatus: input.status,
        firstSeenAt: now,
        lastScannedAt: now,
      })
      .onConflictDoNothing({
        target: [
          mcpDeployments.ownerId,
          mcpDeployments.serverKey,
          mcpDeployments.configFingerprint,
        ],
      })
      .returning({ id: mcpDeployments.id });
    const isFirst = inserted.length > 0;

    const [dep] = await tx
      .select()
      .from(mcpDeployments)
      .where(
        and(
          eq(mcpDeployments.ownerId, input.ownerId),
          eq(mcpDeployments.serverKey, input.serverKey),
          eq(mcpDeployments.configFingerprint, input.configFingerprint),
        ),
      )
      .for('update')
      .limit(1);
    if (!dep) throw new Error('deployment vanished inside its own transaction');

    // Run-length encode: extend the current interval when nothing moved.
    const [last] = await tx
      .select()
      .from(mcpObservations)
      .where(eq(mcpObservations.deploymentId, dep.id))
      .orderBy(desc(mcpObservations.id))
      .limit(1);
    const same =
      last &&
      last.status === input.status &&
      last.contentHash === input.contentHash &&
      last.serverVersion === input.serverVersion;
    if (same) {
      await tx
        .update(mcpObservations)
        .set({ lastSeenAt: now, scanCount: sql`${mcpObservations.scanCount} + 1` })
        .where(eq(mcpObservations.id, last.id));
    } else {
      await tx.insert(mcpObservations).values({
        deploymentId: dep.id,
        ownerId: input.ownerId,
        status: input.status,
        contentHash: input.contentHash,
        serverVersion: input.serverVersion,
        error: input.error,
        source: input.source,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }

    let change: ChangeKind = isFirst ? 'first' : 'unchanged';
    let event: ScanRecordResult['event'] = null;
    const moved =
      !isFirst &&
      input.contentHash &&
      dep.lastContentHash &&
      input.contentHash !== dep.lastContentHash;

    if (moved) {
      const [previous] = await tx
        .select()
        .from(mcpContracts)
        .where(eq(mcpContracts.contentHash, dep.lastContentHash!))
        .limit(1);
      if (previous) {
        const d = diff(previous);
        // A flap back to a contract seen before re-arms the existing event
        // instead of stacking duplicates, and un-acknowledges it: the owner
        // dismissed that change once, and it has happened again.
        await tx
          .insert(mcpChangeEvents)
          .values({
            deploymentId: dep.id,
            ownerId: input.ownerId,
            fromHash: dep.lastContentHash!,
            toHash: input.contentHash!,
            severity: d.severity,
            summary: d.summary.slice(0, 1000),
            diff: d,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [
              mcpChangeEvents.deploymentId,
              mcpChangeEvents.fromHash,
              mcpChangeEvents.toHash,
            ],
            set: {
              createdAt: now,
              acknowledgedAt: null,
              severity: d.severity,
              summary: d.summary.slice(0, 1000),
              diff: d,
            },
          });
        change = 'changed';
        event = { at: now, severity: d.severity, summary: d.summary, rugPull: d.rugPull };
      }
    } else if (!isFirst && dep.lastStatus !== input.status) {
      change = 'status_changed';
    }

    await tx
      .update(mcpDeployments)
      .set({
        alias: input.alias,
        transport: input.transport,
        packageName: input.packageName,
        lastStatus: input.status,
        lastError: input.error,
        lastScannedAt: now,
        ...(input.serverName !== null ? { serverName: input.serverName } : {}),
        ...(input.serverVersion !== null ? { serverVersion: input.serverVersion } : {}),
        // A failed scan keeps the last contract that was read: "the server was
        // unreachable today" must not erase what it exposed yesterday.
        ...(input.contentHash
          ? { lastContentHash: input.contentHash, worstSeverity: input.worstSeverity }
          : {}),
        ...(moved || isFirst ? { lastChangedAt: now } : {}),
      })
      .where(eq(mcpDeployments.id, dep.id));

    return { deploymentId: dep.id, change, event };
  });
}

/** Record a public-server report. Returns how many distinct accounts agree. */
export async function reportPublic(
  db: Database,
  row: {
    registry: string;
    packageName: string;
    version: string;
    contentHash: string;
    ownerId: string;
  },
): Promise<number> {
  await db.insert(mcpPublicReports).values(row).onConflictDoNothing();
  const [agree] = await db
    .select({ n: sql<number>`count(distinct ${mcpPublicReports.ownerId})::int` })
    .from(mcpPublicReports)
    .where(
      and(
        eq(mcpPublicReports.registry, row.registry),
        eq(mcpPublicReports.packageName, row.packageName),
        eq(mcpPublicReports.version, row.version),
        eq(mcpPublicReports.contentHash, row.contentHash),
      ),
    );
  return agree?.n ?? 0;
}

// ── Owner-scoped reads for the dashboard ─────────────────────────────────────

export interface DeploymentSummary extends McpDeploymentRow {
  toolCount: number | null;
  writes: number | null;
  destroys: number | null;
  capabilities: Record<string, number>;
  findings: number;
  openEvents: number;
  openWorst: Severity | null;
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

export async function listDeployments(db: Database, ownerId: string): Promise<DeploymentSummary[]> {
  const rows = await db
    .select({
      d: mcpDeployments,
      c: { toolCount: mcpContracts.toolCount, analysis: mcpContracts.analysis },
    })
    .from(mcpDeployments)
    .leftJoin(mcpContracts, eq(mcpContracts.contentHash, mcpDeployments.lastContentHash))
    .where(eq(mcpDeployments.ownerId, ownerId))
    .orderBy(desc(mcpDeployments.lastScannedAt))
    .limit(500);
  if (rows.length === 0) return [];

  const open = await db
    .select({ deploymentId: mcpChangeEvents.deploymentId, severity: mcpChangeEvents.severity })
    .from(mcpChangeEvents)
    .where(
      and(
        eq(mcpChangeEvents.ownerId, ownerId),
        isNull(mcpChangeEvents.acknowledgedAt),
        inArray(
          mcpChangeEvents.deploymentId,
          rows.map((r) => r.d.id),
        ),
      ),
    );
  const byDep = new Map<number, { n: number; worst: Severity | null }>();
  for (const e of open) {
    const cur = byDep.get(e.deploymentId) ?? { n: 0, worst: null };
    cur.n++;
    if (!cur.worst || RANK[e.severity] < RANK[cur.worst]) cur.worst = e.severity;
    byDep.set(e.deploymentId, cur);
  }

  return rows.map(({ d, c }) => ({
    ...d,
    toolCount: c?.toolCount ?? null,
    writes: c?.analysis?.stats.writes ?? null,
    destroys: c?.analysis?.stats.destroys ?? null,
    capabilities: (c?.analysis?.stats.capabilities ?? {}) as Record<string, number>,
    findings: c?.analysis?.findings.filter((f) => f.severity !== 'info').length ?? 0,
    openEvents: byDep.get(d.id)?.n ?? 0,
    openWorst: byDep.get(d.id)?.worst ?? null,
  }));
}

export interface DeploymentDetail {
  deployment: McpDeploymentRow;
  contract: McpContractRow | null;
  observations: McpObservationRow[];
  events: McpChangeEventRow[];
}

export async function getDeploymentDetail(
  db: Database,
  ownerId: string,
  id: number,
): Promise<DeploymentDetail | null> {
  const [deployment] = await db
    .select()
    .from(mcpDeployments)
    .where(and(eq(mcpDeployments.id, id), eq(mcpDeployments.ownerId, ownerId)))
    .limit(1);
  if (!deployment) return null;
  const [contract, observations, events] = await Promise.all([
    deployment.lastContentHash
      ? getContract(db, deployment.lastContentHash)
      : Promise.resolve(null),
    db
      .select()
      .from(mcpObservations)
      .where(and(eq(mcpObservations.deploymentId, id), eq(mcpObservations.ownerId, ownerId)))
      .orderBy(desc(mcpObservations.id))
      .limit(60),
    db
      .select()
      .from(mcpChangeEvents)
      .where(and(eq(mcpChangeEvents.deploymentId, id), eq(mcpChangeEvents.ownerId, ownerId)))
      .orderBy(desc(mcpChangeEvents.createdAt))
      .limit(50),
  ]);
  return { deployment, contract, observations, events };
}

export async function listChangeEvents(
  db: Database,
  ownerId: string,
  opts: { limit?: number; openOnly?: boolean } = {},
): Promise<(McpChangeEventRow & { alias: string; serverKey: string })[]> {
  const rows = await db
    .select({
      e: mcpChangeEvents,
      alias: mcpDeployments.alias,
      serverKey: mcpDeployments.serverKey,
    })
    .from(mcpChangeEvents)
    .innerJoin(mcpDeployments, eq(mcpDeployments.id, mcpChangeEvents.deploymentId))
    .where(
      and(
        eq(mcpChangeEvents.ownerId, ownerId),
        opts.openOnly ? isNull(mcpChangeEvents.acknowledgedAt) : undefined,
      ),
    )
    .orderBy(desc(mcpChangeEvents.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map((r) => ({ ...r.e, alias: r.alias, serverKey: r.serverKey }));
}

/** Acknowledge one event. False when it does not exist for this owner. */
export async function acknowledgeEvent(
  db: Database,
  ownerId: string,
  eventId: number,
): Promise<boolean> {
  const rows = await db
    .update(mcpChangeEvents)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(mcpChangeEvents.id, eventId), eq(mcpChangeEvents.ownerId, ownerId)))
    .returning({ id: mcpChangeEvents.id });
  return rows.length > 0;
}

export interface AccountDeployment {
  serverKey: string;
  alias: string;
  lastStatus: ScanStatus;
  lastError: string | null;
  lastContentHash: string | null;
  lastScannedAt: Date;
  analysis: import('../mcpScan/analyze').ServerAnalysis | null;
  openEvents: number;
  openWorst: Severity | null;
}

/**
 * The owner's deployments with the full analysis of each one's latest contract,
 * for answering `audit` from the account's own scans. Two queries: the summary
 * (which already counts open changes) and the analyses by content hash.
 */
export async function listAccountDeployments(
  db: Database,
  ownerId: string,
): Promise<AccountDeployment[]> {
  const summaries = await listDeployments(db, ownerId);
  const hashes = [
    ...new Set(summaries.map((s) => s.lastContentHash).filter((h): h is string => !!h)),
  ];
  const analyses = hashes.length
    ? await db
        .select({ hash: mcpContracts.contentHash, analysis: mcpContracts.analysis })
        .from(mcpContracts)
        .where(inArray(mcpContracts.contentHash, hashes))
    : [];
  const byHash = new Map(analyses.map((a) => [a.hash, a.analysis]));
  return summaries.map((s) => ({
    serverKey: s.serverKey,
    alias: s.alias,
    lastStatus: s.lastStatus,
    lastError: s.lastError,
    lastContentHash: s.lastContentHash,
    lastScannedAt: s.lastScannedAt,
    analysis: s.lastContentHash ? (byHash.get(s.lastContentHash) ?? null) : null,
    openEvents: s.openEvents,
    openWorst: s.openWorst,
  }));
}
