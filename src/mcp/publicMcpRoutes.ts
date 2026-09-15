/**
 * HTTP routes for public MCP endpoints: pins, acknowledgements, and the detail
 * page an alert links to.
 *
 * Two audiences, two auth models, like every other route family here:
 *   - the CLI and agents, with the account's API key (`/mcp-pins`,
 *     `/mcp-public-changes/:id/acknowledge`)
 *   - the dashboard, through the issuer secret with an explicit ownerId
 *     (`/mcp-public/...`)
 *
 * The endpoint data itself is public — a credential-free read of a registry
 * listing — so any account may read any endpoint's detail. What is scoped to the
 * account is its pin, its acknowledgements, and which changes it is told about.
 *
 * Kept out of http.ts so the routes mount on a bare express app in tests.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { capture } from '../core/analytics';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { getContract } from '../db/mcpScans';
import {
  acknowledgedChangeIds,
  acknowledgePublicChange,
  getPin,
  listPins,
  pinEndpoint,
  publicChangeExists,
  unpinEndpoint,
  type PinStatus,
} from '../db/publicMcpAlerts';
import { getEndpointById, listEndpointChanges, listEndpointObservations, listServerNamesForEndpoint } from '../db/remoteEndpoints';
import { recordUsage } from '../db/usage';

export interface PublicMcpRouteDeps {
  db: Database;
  ipLimiter: RequestHandler;
  auth: RequestHandler;
  keyLimiter: RequestHandler;
  requireIssuerSecret: RequestHandler;
  ownerFrom: (req: Request) => string;
  keyOwner: (req: Request, res: Response) => string | null;
}

const ServerBody = z.object({
  server: z.string().trim().min(1).max(2048),
  note: z.string().trim().max(500).optional(),
});

function fail(res: Response, what: string, err: unknown): void {
  logger.error(`${what} failed:`, formatError(err));
  res.status(500).json({ error: `Could not ${what}.` });
}

const NOT_PROBED =
  'lurq has no probed remote endpoint for that server. Check the URL or registry name, or run connect_check to see what lurq knows about it.';

/** A pin as the CLI and dashboard read it: no internal ids beyond the endpoint's. */
export function pinView(p: PinStatus) {
  return {
    endpointId: p.endpoint.id,
    url: p.endpoint.url,
    note: p.pin.note,
    pinnedAt: p.pin.pinnedAt.toISOString(),
    status: p.endpoint.lastStatus,
    lastProbedAt: p.endpoint.lastProbedAt?.toISOString() ?? null,
    contractChanged: p.contractChanged,
    authChanged: p.authChanged,
    openChanges: p.openChanges,
    worstOpen: p.worstOpen,
  };
}

function positiveId(raw: unknown, res: Response): number | null {
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'A numeric id is required.' });
    return null;
  }
  return id;
}

export function registerPublicMcpRoutes(app: Express, d: PublicMcpRouteDeps): void {
  const resolve = async (query: string) => (await import('../connect/check')).resolveServerEndpoint(d.db, query);

  // ── API key: the CLI and agents ────────────────────────────────────────────

  app.get('/mcp-pins', d.ipLimiter, d.auth, d.keyLimiter, async (req: Request, res: Response) => {
    const ownerId = d.keyOwner(req, res);
    if (!ownerId) return;
    try {
      res.status(200).json({ pins: (await listPins(d.db, ownerId)).map(pinView) });
    } catch (err) {
      fail(res, 'list pins', err);
    }
  });

  app.post('/mcp-pins', d.ipLimiter, d.auth, d.keyLimiter, async (req: Request, res: Response) => {
    const ownerId = d.keyOwner(req, res);
    if (!ownerId) return;
    const body = ServerBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: 'Pass `server`: an endpoint URL or an official registry name.' });
      return;
    }
    try {
      const endpoint = await resolve(body.data.server);
      if (!endpoint) {
        res.status(404).json({ error: NOT_PROBED });
        return;
      }
      await pinEndpoint(d.db, ownerId, endpoint.id, body.data.note ?? null);
      const pin = await getPin(d.db, ownerId, endpoint.id);
      capture(ownerId, 'mcp_pinned', { via: 'api' });
      void recordUsage(d.db, ownerId, 'mcp-pin');
      res.status(200).json({ pin: pin ? pinView(pin) : null });
    } catch (err) {
      fail(res, 'pin the server', err);
    }
  });

  app.post('/mcp-pins/unpin', d.ipLimiter, d.auth, d.keyLimiter, async (req: Request, res: Response) => {
    const ownerId = d.keyOwner(req, res);
    if (!ownerId) return;
    const body = ServerBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: 'Pass `server`: an endpoint URL or an official registry name.' });
      return;
    }
    try {
      const endpoint = await resolve(body.data.server);
      if (!endpoint) {
        res.status(404).json({ error: NOT_PROBED });
        return;
      }
      res.status(200).json({ unpinned: await unpinEndpoint(d.db, ownerId, endpoint.id) });
    } catch (err) {
      fail(res, 'unpin the server', err);
    }
  });

  app.post('/mcp-public-changes/:id/acknowledge', d.ipLimiter, d.auth, d.keyLimiter, async (req: Request, res: Response) => {
    const ownerId = d.keyOwner(req, res);
    if (!ownerId) return;
    const id = positiveId(req.params.id, res);
    if (!id) return;
    try {
      if (!(await publicChangeExists(d.db, id))) {
        res.status(404).json({ error: 'No such change.' });
        return;
      }
      await acknowledgePublicChange(d.db, ownerId, id);
      res.status(200).json({ acknowledged: true });
    } catch (err) {
      fail(res, 'acknowledge the change', err);
    }
  });

  // ── Issuer secret: the dashboard ───────────────────────────────────────────

  const owner = (req: Request, res: Response): string | null => {
    const ownerId = d.ownerFrom(req);
    if (!ownerId) res.status(400).json({ error: 'ownerId is required.' });
    return ownerId || null;
  };

  app.get('/mcp-public/:endpointId', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const endpointId = positiveId(req.params.endpointId, res);
    if (!endpointId) return;
    try {
      const endpoint = await getEndpointById(d.db, endpointId);
      if (!endpoint) {
        res.status(404).json({ error: 'No such endpoint.' });
        return;
      }
      const { handleConnectCheck } = await import('../connect/check');
      const [servers, contract, observations, changes, pin, compat] = await Promise.all([
        listServerNamesForEndpoint(d.db, endpointId),
        endpoint.lastContentHash ? getContract(d.db, endpoint.lastContentHash) : Promise.resolve(null),
        listEndpointObservations(d.db, endpointId, 30),
        listEndpointChanges(d.db, endpointId, 30),
        getPin(d.db, ownerId, endpointId),
        // Stored facts only: a dashboard read never triggers a probe.
        handleConnectCheck(d.db, { server: endpoint.url }),
      ]);
      const acked = await acknowledgedChangeIds(d.db, ownerId, changes.map((c) => c.id));
      res.status(200).json({
        endpoint: {
          id: endpoint.id,
          url: endpoint.url,
          host: endpoint.host,
          transport: endpoint.transport,
          status: endpoint.lastStatus,
          httpStatus: endpoint.lastHttpStatus,
          auth: endpoint.auth,
          violations: endpoint.violations,
          protocolMode: endpoint.protocolMode,
          protocolVersion: endpoint.protocolVersion,
          serverName: endpoint.serverName,
          serverVersion: endpoint.serverVersion,
          latencyMs: endpoint.latencyMs,
          lastError: endpoint.lastError,
          firstSeenAt: endpoint.firstSeenAt,
          lastProbedAt: endpoint.lastProbedAt,
          lastChangedAt: endpoint.lastChangedAt,
          removedAt: endpoint.removedAt,
        },
        servers,
        contract: contract ? { tools: contract.tools, analysis: contract.analysis } : null,
        observations,
        changes: changes.map((c) => ({ ...c, acknowledged: acked.has(c.id) })),
        pin: pin ? pinView(pin) : null,
        clients: compat.clients.map((c) => ({ client: c.client, clientName: c.clientName, verdict: c.verdict, reason: (c.blockers[0] ?? c.setup[0] ?? c.unknowns.find((u) => u.decisive))?.detail ?? null })),
        summary: compat.summary,
      });
    } catch (err) {
      fail(res, 'read the endpoint', err);
    }
  });

  app.post('/mcp-public/changes/:id/acknowledge', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const id = positiveId(req.params.id, res);
    if (!id) return;
    try {
      if (!(await publicChangeExists(d.db, id))) {
        res.status(404).json({ error: 'No such change.' });
        return;
      }
      await acknowledgePublicChange(d.db, ownerId, id);
      res.status(200).json({ acknowledged: true });
    } catch (err) {
      fail(res, 'acknowledge the change', err);
    }
  });

  app.post('/mcp-public/:endpointId/pin', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const endpointId = positiveId(req.params.endpointId, res);
    if (!endpointId) return;
    try {
      const row = await pinEndpoint(d.db, ownerId, endpointId);
      if (!row) {
        res.status(404).json({ error: 'No such endpoint.' });
        return;
      }
      capture(ownerId, 'mcp_pinned', { via: 'dashboard' });
      const pin = await getPin(d.db, ownerId, endpointId);
      res.status(200).json({ pin: pin ? pinView(pin) : null });
    } catch (err) {
      fail(res, 'pin the server', err);
    }
  });

  app.post('/mcp-public/:endpointId/unpin', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const endpointId = positiveId(req.params.endpointId, res);
    if (!endpointId) return;
    try {
      res.status(200).json({ unpinned: await unpinEndpoint(d.db, ownerId, endpointId) });
    } catch (err) {
      fail(res, 'unpin the server', err);
    }
  });
}
