/**
 * HTTP routes for live MCP scans.
 *
 * Two audiences, two auth models, same as the rest of the hosted server:
 *   - the CLI uploads with the user's API key (`POST /mcp-scans`)
 *   - the dashboard reads through the issuer secret with an explicit ownerId
 *
 * Kept out of http.ts so the routes can be mounted on a bare express app in
 * tests with the real guards swapped for fakes.
 */
import type { Express, Request, RequestHandler, Response } from 'express';
import { formatError } from '../core/errors';
import { logger } from '../core/logger';
import type { Database } from '../db/client';
import { acknowledgeEvent, getDeploymentDetail, listChangeEvents, listDeployments } from '../db/mcpScans';
import { recordUsage } from '../db/usage';
import { ingestScan, parseUpload } from '../mcpScan/ingest';

export const MCP_SCAN_UPLOAD_PATH = '/mcp-scans';

/**
 * Uploads carry whole tool contracts, which a large server pushes past the 1mb
 * every other route is held to. The client chunks well under this; the ceiling
 * is here so a single pathological server cannot be sent at all.
 */
export const MCP_SCAN_BODY_LIMIT = '8mb';

export interface McpScanRouteDeps {
  db: Database;
  ipLimiter: RequestHandler;
  auth: RequestHandler;
  keyLimiter: RequestHandler;
  quota: RequestHandler;
  /** JSON parser with MCP_SCAN_BODY_LIMIT. Runs AFTER auth, so an anonymous
   *  client can never make the server parse eight megabytes. */
  bigJson: RequestHandler;
  requireIssuerSecret: RequestHandler;
  ownerFrom: (req: Request) => string;
  keyOwner: (req: Request, res: Response) => string | null;
}

function fail(res: Response, what: string, err: unknown): void {
  logger.error(`${what} failed:`, formatError(err));
  res.status(500).json({ error: `Could not ${what}.` });
}

export function registerMcpScanRoutes(app: Express, d: McpScanRouteDeps): void {
  app.post(
    MCP_SCAN_UPLOAD_PATH,
    d.ipLimiter,
    d.auth,
    d.keyLimiter,
    d.quota,
    d.bigJson,
    async (req: Request, res: Response) => {
      const ownerId = d.keyOwner(req, res);
      if (!ownerId) return;
      const parsed = parseUpload(req.body);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      if (parsed.servers.length === 0) {
        res.status(400).json({ error: 'No server in this upload could be accepted.', rejected: parsed.rejected });
        return;
      }
      try {
        res.status(200).json(await ingestScan(d.db, ownerId, parsed));
        void recordUsage(d.db, ownerId, 'mcp-scans');
      } catch (err) {
        fail(res, 'record the scan', err);
      }
    },
  );

  const owner = (req: Request, res: Response): string | null => {
    const ownerId = d.ownerFrom(req);
    if (!ownerId) res.status(400).json({ error: 'ownerId is required.' });
    return ownerId || null;
  };

  const numericId = (req: Request, res: Response): number | null => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'A numeric id is required.' });
      return null;
    }
    return id;
  };

  app.get('/mcp-servers', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    try {
      const [servers, events] = await Promise.all([
        listDeployments(d.db, ownerId),
        listChangeEvents(d.db, ownerId, { limit: 30 }),
      ]);
      res.status(200).json({ servers, events });
    } catch (err) {
      fail(res, 'read MCP servers', err);
    }
  });

  app.get('/mcp-servers/:id', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const id = numericId(req, res);
    if (!id) return;
    try {
      const detail = await getDeploymentDetail(d.db, ownerId, id);
      if (!detail) {
        res.status(404).json({ error: 'No such server for this account.' });
        return;
      }
      res.status(200).json(detail);
    } catch (err) {
      fail(res, 'read the MCP server', err);
    }
  });

  app.post('/mcp-servers/events/:id/acknowledge', d.requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = owner(req, res);
    if (!ownerId) return;
    const id = numericId(req, res);
    if (!id) return;
    try {
      if (!(await acknowledgeEvent(d.db, ownerId, id))) {
        res.status(404).json({ error: 'No such change for this account.' });
        return;
      }
      res.status(200).json({ acknowledged: true });
    } catch (err) {
      fail(res, 'acknowledge the change', err);
    }
  });
}
