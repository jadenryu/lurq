/**
 * What is worth an email, read from the rows the product already writes.
 *
 * URGENT is deliberately three things, each one a change that needs action
 * today and that nobody would otherwise notice:
 *   - an MCP server rewrote a tool's description and it now instructs the model
 *   - an MCP tool stopped being read-only (privilege widening)
 *   - a breaking major that the repo's declared range will install by itself
 * Everything else — a new tool, a major you are pinned behind, a heuristic
 * finding — waits for the dashboard or the opt-in weekly summary.
 *
 * Only items from the last day are considered. The first deploy of the sender
 * must not email every account its entire backlog.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { mcpChangeEvents, mcpDeployments, repoAlerts, repos, type RepoAlertRow } from '../db/schema';
import type { SnapshotDiff } from '../mcpScan/analyze';
import type { DigestSummary, UrgentItem } from './render';

export const URGENT_WINDOW_MS = 24 * 3_600_000;
const DAY_MS = 86_400_000;

const RANK: Record<UrgentItem['kind'], number> = { mcp_rug_pull: 0, mcp_privilege: 1, breaking_release: 2 };

export const sortUrgent = (items: UrgentItem[]) => [...items].sort((a, b) => RANK[a.kind] - RANK[b.kind]);

function alertItem(a: RepoAlertRow, webUrl: string): UrgentItem {
  return {
    key: `alert:${a.id}`,
    kind: 'breaking_release',
    title: `${a.packageName} ${a.toVersion} will install on its own in ${a.repoFullName}`,
    detail: `The range ${a.range} already admits ${a.toVersion}, a new major${a.fromVersion ? ` (it resolves ${a.fromVersion} today)` : ''}. The next clean install takes it unless the range is tightened.`,
    url: `${webUrl}/dashboard/repos/${a.repoId}?q=${encodeURIComponent(a.packageName)}#deps`,
  };
}

interface EventRow {
  id: number;
  deploymentId: number;
  ownerId: string;
  summary: string;
  diff: SnapshotDiff;
  alias: string;
}

/** An MCP change's urgent item, or null when the change is not urgent. */
export function eventItem(e: EventRow, webUrl: string): UrgentItem | null {
  const url = `${webUrl}/dashboard/mcp/${e.deploymentId}`;
  const rug = e.diff?.rugPull ?? [];
  if (rug.length) {
    return {
      key: `mcp:${e.id}`,
      kind: 'mcp_rug_pull',
      title: `${e.alias}: ${rug.slice(0, 3).join(', ')} now ${rug.length === 1 ? 'instructs' : 'instruct'} your agent`,
      detail: `A tool description changed after this server was scanned, and the new text tells the model what to do. Review it before your agent uses the server again. ${e.summary}`.slice(0, 600),
      url,
    };
  }
  const widened = (e.diff?.contract?.annotationFlips ?? []).filter((f) => f.widensPrivilege);
  if (widened.length) {
    return {
      key: `mcp:${e.id}`,
      kind: 'mcp_privilege',
      title: `${e.alias}: ${widened[0]!.tool} can now do more than you approved`,
      detail: widened.map((f) => `${f.tool}.${f.hint} ${f.from} → ${f.to}`).join('; ').slice(0, 600),
      url,
    };
  }
  return null;
}

/** Urgent items from the last day, grouped by owner, oldest claims excluded later. */
export async function urgentCandidates(db: Database, now: Date, webUrl: string): Promise<Map<string, UrgentItem[]>> {
  const since = new Date(now.getTime() - URGENT_WINDOW_MS);
  const [alerts, events] = await Promise.all([
    db
      .select()
      .from(repoAlerts)
      .where(and(eq(repoAlerts.inRange, true), gte(repoAlerts.createdAt, since)))
      .limit(5000),
    db
      .select({
        id: mcpChangeEvents.id,
        deploymentId: mcpChangeEvents.deploymentId,
        ownerId: mcpChangeEvents.ownerId,
        summary: mcpChangeEvents.summary,
        diff: mcpChangeEvents.diff,
        alias: mcpDeployments.alias,
      })
      .from(mcpChangeEvents)
      .innerJoin(mcpDeployments, eq(mcpDeployments.id, mcpChangeEvents.deploymentId))
      .where(and(isNull(mcpChangeEvents.acknowledgedAt), gte(mcpChangeEvents.createdAt, since)))
      .limit(5000),
  ]);

  const byOwner = new Map<string, UrgentItem[]>();
  const push = (owner: string, item: UrgentItem) => {
    const list = byOwner.get(owner);
    if (list) list.push(item);
    else byOwner.set(owner, [item]);
  };
  for (const a of alerts) push(a.ownerId, alertItem(a, webUrl));
  for (const e of events) {
    const item = eventItem(e, webUrl);
    if (item) push(e.ownerId, item);
  }
  return byOwner;
}

/** Rebuild items from their keys, for retrying a delivery. Missing rows are dropped. */
export async function loadUrgentItems(db: Database, keys: string[], webUrl: string): Promise<UrgentItem[]> {
  const ids = (prefix: string) =>
    keys.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length))).filter(Number.isInteger);
  const alertIds = ids('alert:');
  const eventIds = ids('mcp:');
  const [alerts, events] = await Promise.all([
    alertIds.length ? db.select().from(repoAlerts).where(inArray(repoAlerts.id, alertIds)) : Promise.resolve([]),
    eventIds.length
      ? db
          .select({
            id: mcpChangeEvents.id,
            deploymentId: mcpChangeEvents.deploymentId,
            ownerId: mcpChangeEvents.ownerId,
            summary: mcpChangeEvents.summary,
            diff: mcpChangeEvents.diff,
            alias: mcpDeployments.alias,
          })
          .from(mcpChangeEvents)
          .innerJoin(mcpDeployments, eq(mcpDeployments.id, mcpChangeEvents.deploymentId))
          .where(inArray(mcpChangeEvents.id, eventIds))
      : Promise.resolve([]),
  ]);
  return sortUrgent([
    ...alerts.map((a) => alertItem(a, webUrl)),
    ...events.map((e) => eventItem(e, webUrl)).filter((i): i is UrgentItem => !!i),
  ]);
}

/** The week's summary for one account, or null when it watches nothing. */
export async function buildDigest(db: Database, ownerId: string, now: Date, webUrl: string): Promise<DigestSummary | null> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [deployments, [repoCount], events, eventTotal, alerts, alertTotal] = await Promise.all([
    db
      .select({ id: mcpDeployments.id, alias: mcpDeployments.alias, lastStatus: mcpDeployments.lastStatus, lastScannedAt: mcpDeployments.lastScannedAt })
      .from(mcpDeployments)
      .where(eq(mcpDeployments.ownerId, ownerId)),
    db.select({ n: sql<number>`count(*)::int` }).from(repos).where(eq(repos.ownerId, ownerId)),
    db
      .select({ id: mcpChangeEvents.id, deploymentId: mcpChangeEvents.deploymentId, severity: mcpChangeEvents.severity, summary: mcpChangeEvents.summary, alias: mcpDeployments.alias })
      .from(mcpChangeEvents)
      .innerJoin(mcpDeployments, eq(mcpDeployments.id, mcpChangeEvents.deploymentId))
      .where(and(eq(mcpChangeEvents.ownerId, ownerId), gte(mcpChangeEvents.createdAt, since)))
      .orderBy(desc(mcpChangeEvents.createdAt))
      .limit(8),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(mcpChangeEvents)
      .where(and(eq(mcpChangeEvents.ownerId, ownerId), gte(mcpChangeEvents.createdAt, since))),
    db
      .select()
      .from(repoAlerts)
      .where(and(eq(repoAlerts.ownerId, ownerId), gte(repoAlerts.createdAt, since)))
      .orderBy(desc(repoAlerts.inRange), desc(repoAlerts.createdAt))
      .limit(8),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(repoAlerts)
      .where(and(eq(repoAlerts.ownerId, ownerId), gte(repoAlerts.createdAt, since))),
  ]);

  const watchedRepos = repoCount?.n ?? 0;
  if (deployments.length === 0 && watchedRepos === 0) return null;

  const staleBefore = new Date(now.getTime() - 7 * DAY_MS);
  return {
    weekOf: since.toISOString().slice(0, 10),
    watched: { servers: deployments.length, repos: watchedRepos },
    mcpChanges: events.map((e) => ({ severity: e.severity, alias: e.alias, summary: e.summary, url: `${webUrl}/dashboard/mcp/${e.deploymentId}` })),
    mcpChangeTotal: eventTotal[0]?.n ?? 0,
    alerts: alerts.map((a) => ({ ...alertItem(a, webUrl), title: `${a.packageName} ${a.toVersion} in ${a.repoFullName}` })),
    alertTotal: alertTotal[0]?.n ?? 0,
    unreadable: deployments
      .filter((d) => d.lastStatus !== 'ok' && d.lastStatus !== 'partial')
      .slice(0, 8)
      .map((d) => ({ alias: d.alias, status: d.lastStatus, url: `${webUrl}/dashboard/mcp/${d.id}` })),
    stale: deployments
      .filter((d) => d.lastScannedAt < staleBefore)
      .slice(0, 8)
      .map((d) => ({ alias: d.alias, days: Math.floor((now.getTime() - d.lastScannedAt.getTime()) / DAY_MS), url: `${webUrl}/dashboard/mcp/${d.id}` })),
  };
}

