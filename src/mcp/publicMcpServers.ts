/**
 * Public MCP server summaries: the data behind lurq.run/mcp/<registry name>.
 *
 * These pages exist to be found by the searches people make when a server does
 * not connect: "does <server> work with ChatGPT", "<server> Cursor setup",
 * "<server> 401". Each answers from lurq's credential-free probe of the
 * server's endpoint and the sourced client profiles, and shows that an agent can
 * ask `connect_check` live for the version and client it is about to use.
 *
 * DELIBERATELY A SUMMARY, like publicPackages.ts. Tool names, not schemas;
 * verdicts and their one-line reasons, not setup steps or rendered config.
 * Those stay behind a key. Only registry servers with a probed endpoint get a
 * page: a page of all-unknown verdicts helps nobody and reads as thin content.
 */
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { CompatVerdict } from '../clients/evaluate';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { getContract } from '../db/mcpScans';
import { getEndpointsForServer } from '../db/remoteEndpoints';
import { mcpEndpointServers, mcpRegistryServers, mcpRemoteEndpoints } from '../db/schema';
import type { EndpointStatus, Violation } from '../remoteProbe/types';

/** Reverse-DNS namespace, a slash, a server name: `io.github.acme/weather`. */
const REGISTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,199}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
export const PUBLIC_MCP_LIMIT = 20_000;

export function validRegistryName(name: string): boolean {
  return REGISTRY_NAME.test(name);
}

export interface PublicMcpServerSummary {
  name: string;
  title: string | null;
  description: string | null;
  websiteUrl: string | null;
  repositoryUrl: string | null;
  version: string;
  endpoint: {
    url: string;
    transport: string;
    status: EndpointStatus | null;
    authMode: 'none' | 'oauth' | 'static' | 'unknown';
    oauth: { cimd: boolean; dcr: boolean; pkceS256: boolean } | null;
    violations: Violation[];
    toolNames: string[] | null;
    lastProbedAt: string | null;
  } | null;
  otherEndpoints: number;
  hasPackage: boolean;
  clients: { client: string; clientName: string; verdict: CompatVerdict; reason: string | null }[];
  summary: Record<CompatVerdict, number>;
  dataAsOf: string | null;
}

/** The summary for one registry server, or null when it has no page. */
export async function publicMcpServerSummary(
  db: Database,
  name: string,
): Promise<PublicMcpServerSummary | null> {
  const [server] = await db
    .select()
    .from(mcpRegistryServers)
    .where(and(eq(mcpRegistryServers.name, name), eq(mcpRegistryServers.isLatest, true)))
    .limit(1);
  if (!server || server.status === 'deleted') return null;

  const { handleConnectCheck, resolveServerEndpoint } = await import('../connect/check');
  const best = await resolveServerEndpoint(db, name);
  if (!best?.lastStatus) return null;

  const [linked, compat, contract] = await Promise.all([
    getEndpointsForServer(db, name),
    handleConnectCheck(db, { server: name }),
    best.lastContentHash ? getContract(db, best.lastContentHash) : Promise.resolve(null),
  ]);

  return {
    name: server.name,
    title: server.title,
    description: server.description,
    websiteUrl: server.websiteUrl,
    repositoryUrl: server.repositoryUrl,
    version: server.version,
    endpoint: {
      url: best.url,
      transport: best.transport,
      status: best.lastStatus,
      authMode: best.auth?.mode ?? 'unknown',
      oauth: best.auth?.oauth
        ? {
            cimd: best.auth.oauth.cimd,
            dcr: best.auth.oauth.dcr,
            pkceS256: best.auth.oauth.pkceS256,
          }
        : null,
      violations: best.violations ?? [],
      toolNames: contract ? contract.tools.map((t) => t.name) : null,
      lastProbedAt: best.lastProbedAt?.toISOString() ?? null,
    },
    otherEndpoints: Math.max(0, linked.length - 1),
    hasPackage: server.packages.length > 0,
    clients: compat.clients.map((c) => ({
      client: c.client,
      clientName: c.clientName,
      verdict: c.verdict,
      reason: (c.blockers[0] ?? c.setup[0] ?? c.unknowns.find((u) => u.decisive))?.detail ?? null,
    })),
    summary: compat.summary,
    dataAsOf: best.lastProbedAt?.toISOString() ?? null,
  };
}

/** Every server that has a page, most recently probed first. */
export async function listPublicMcpServers(
  db: Database,
): Promise<{ name: string; dataAsOf: string | null }[]> {
  const latest = sql<Date | null>`max(${mcpRemoteEndpoints.lastProbedAt})`;
  const rows = await db
    .select({ name: mcpEndpointServers.serverName, dataAsOf: latest })
    .from(mcpEndpointServers)
    .innerJoin(mcpRemoteEndpoints, eq(mcpRemoteEndpoints.id, mcpEndpointServers.endpointId))
    .where(
      and(
        isNull(mcpEndpointServers.removedAt),
        isNull(mcpRemoteEndpoints.removedAt),
        isNotNull(mcpRemoteEndpoints.lastStatus),
      ),
    )
    .groupBy(mcpEndpointServers.serverName)
    .orderBy(desc(latest))
    .limit(PUBLIC_MCP_LIMIT);
  return rows
    .filter((r) => validRegistryName(r.name))
    .map((r) => ({
      name: r.name,
      dataAsOf: r.dataAsOf ? new Date(r.dataAsOf).toISOString() : null,
    }));
}

export function registerPublicMcpServerRoutes(
  app: Express,
  db: Database,
  limiter: RequestHandler,
): void {
  const cacheable = (res: Response) =>
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');

  app.get('/public/mcp-server', limiter, async (req: Request, res: Response) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!validRegistryName(name)) {
      res
        .status(400)
        .json({ error: 'Give an official MCP registry name, e.g. io.github.acme/weather.' });
      return;
    }
    try {
      const summary = await publicMcpServerSummary(db, name);
      if (!summary) {
        res.status(404).json({ error: 'No public summary for that server.' });
        return;
      }
      cacheable(res);
      res.json(summary);
    } catch (err) {
      logger.error(
        'public MCP server read failed:',
        err instanceof Error ? err.message : String(err),
      );
      res.status(500).json({ error: 'Could not read that server.' });
    }
  });

  app.get('/public/mcp-servers', limiter, async (_req: Request, res: Response) => {
    try {
      const servers = await listPublicMcpServers(db);
      cacheable(res);
      res.json({ servers });
    } catch (err) {
      logger.error(
        'public MCP server list failed:',
        err instanceof Error ? err.message : String(err),
      );
      res.status(500).json({ error: 'Could not list servers.' });
    }
  });
}
