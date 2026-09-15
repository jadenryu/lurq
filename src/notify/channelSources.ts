/**
 * What a channel may carry: every change from the last day, with a severity the
 * channel's own threshold filters on.
 *
 * MCP changes keep the severity their diff earned. A breaking release is `high`
 * when the repo's range will install it on its own and `moderate` when the repo
 * is merely a major behind, the same line the dashboard's alert feed draws.
 */
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { mcpChangeEvents, mcpDeployments, repoAlerts, type RepoAlertRow } from '../db/schema';
import type { ChannelItem } from './channels';
import { loadPublicChanges, publicChangesForOwners } from '../db/publicMcpAlerts';
import { parsePublicItemKey, publicChannelItem } from './publicSources';
import { eventItem, URGENT_WINDOW_MS } from './sources';

function fromAlert(a: RepoAlertRow, webUrl: string): ChannelItem {
  return {
    key: `alert:${a.id}`,
    severity: a.inRange ? 'high' : 'moderate',
    source: 'release',
    title: `${a.packageName} ${a.toVersion} in ${a.repoFullName}`,
    detail: a.inRange
      ? `The range ${a.range} already admits ${a.toVersion}, a new major; the next clean install takes it.`
      : `${a.repoFullName} is now a major behind (declares ${a.range}).`,
    url: `${webUrl}/dashboard/repos/${a.repoId}?q=${encodeURIComponent(a.packageName)}#deps`,
  };
}

interface EventRow {
  id: number;
  deploymentId: number;
  ownerId: string;
  severity: ChannelItem['severity'];
  summary: string;
  diff: Parameters<typeof eventItem>[0]['diff'];
  alias: string;
}

function fromEvent(e: EventRow, webUrl: string): ChannelItem {
  // The urgent wording when it applies, because it says what to do.
  const urgent = eventItem(e, webUrl);
  return {
    key: `mcp:${e.id}`,
    severity: e.severity,
    source: 'mcp',
    title: urgent?.title ?? `${e.alias} changed`,
    detail: e.summary,
    url: `${webUrl}/dashboard/mcp/${e.deploymentId}`,
  };
}

const eventColumns = {
  id: mcpChangeEvents.id,
  deploymentId: mcpChangeEvents.deploymentId,
  ownerId: mcpChangeEvents.ownerId,
  severity: mcpChangeEvents.severity,
  summary: mcpChangeEvents.summary,
  diff: mcpChangeEvents.diff,
  alias: mcpDeployments.alias,
};

export async function channelCandidates(db: Database, now: Date, webUrl: string): Promise<Map<string, ChannelItem[]>> {
  const since = new Date(now.getTime() - URGENT_WINDOW_MS);
  const [alerts, events, publicChanges] = await Promise.all([
    db.select().from(repoAlerts).where(gte(repoAlerts.createdAt, since)).limit(10_000),
    db
      .select(eventColumns)
      .from(mcpChangeEvents)
      .innerJoin(mcpDeployments, eq(mcpDeployments.id, mcpChangeEvents.deploymentId))
      .where(and(isNull(mcpChangeEvents.acknowledgedAt), gte(mcpChangeEvents.createdAt, since)))
      .limit(10_000),
    publicChangesForOwners(db, since, { limit: 10_000 }),
  ]);
  const byOwner = new Map<string, ChannelItem[]>();
  const push = (owner: string, item: ChannelItem) => {
    const list = byOwner.get(owner);
    if (list) list.push(item);
    else byOwner.set(owner, [item]);
  };
  for (const a of alerts) push(a.ownerId, fromAlert(a, webUrl));
  for (const e of events) push(e.ownerId, fromEvent(e, webUrl));
  for (const c of publicChanges) push(c.ownerId, publicChannelItem(c, webUrl));
  return byOwner;
}

export async function loadChannelItems(db: Database, keys: string[], webUrl: string): Promise<ChannelItem[]> {
  const ids = (p: string) => keys.filter((k) => k.startsWith(p)).map((k) => Number(k.slice(p.length))).filter(Number.isInteger);
  const alertIds = ids('alert:');
  const eventIds = ids('mcp:');
  const publicPairs = keys.map(parsePublicItemKey).filter((p): p is NonNullable<typeof p> => p !== null);
  const [alerts, events, publicChanges] = await Promise.all([
    alertIds.length ? db.select().from(repoAlerts).where(inArray(repoAlerts.id, alertIds)) : Promise.resolve([]),
    eventIds.length
      ? db
          .select(eventColumns)
          .from(mcpChangeEvents)
          .innerJoin(mcpDeployments, eq(mcpDeployments.id, mcpChangeEvents.deploymentId))
          .where(inArray(mcpChangeEvents.id, eventIds))
      : Promise.resolve([]),
    loadPublicChanges(db, publicPairs),
  ]);
  return [
    ...alerts.map((a) => fromAlert(a, webUrl)),
    ...events.map((e) => fromEvent(e, webUrl)),
    ...publicChanges.map((c) => publicChannelItem(c, webUrl)),
  ];
}
