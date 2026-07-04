/**
 * Hosted HTTP transport for the MCP server (docs/lurq-hosted-deployment.md §4–5).
 *
 * Stateless Streamable HTTP: one shared DB pool created at startup, a fresh MCP
 * server+transport per request, fronted by helmet + rate limiting + API-key auth.
 * The DB credentials stay server-side; users connect with only a URL + Bearer key.
 * `buildMcpServer` is reused verbatim from the stdio path — the tools are
 * transport-agnostic.
 *
 * express/helmet/express-rate-limit are imported dynamically so the CLI and the
 * install wizard never pull server-only deps into their startup path.
 */
import type { NextFunction, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import { lookupActiveKey } from '../auth/apiKeys';
import { createDb } from '../db/client';
import type { ApiKeyRow } from '../db/schema';
import { buildMcpServer } from './server';
import { renderPrometheus } from './metrics';

interface AuthedRequest extends Request {
  lurqKey?: ApiKeyRow;
}

/** JSON-RPC-shaped error envelope for HTTP-level rejections. */
function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message }, id: null };
}

export async function startHttpServer(opts: { port?: number } = {}): Promise<void> {
  const config = getConfig();
  const port = opts.port ?? config.PORT;

  const [{ default: express }, { default: helmet }, { rateLimit, ipKeyGenerator }] =
    await Promise.all([import('express'), import('helmet'), import('express-rate-limit')]);

  // The DB pool is the expensive resource — created once, shared by all requests.
  const { db } = createDb({ max: 20 });

  const app = express();
  app.set('trust proxy', 1); // Railway terminates TLS at the edge.
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  // Unauthenticated, no DB hit — for Railway's healthcheck. Intentionally not
  // rate-limited: it's a static response with no backend cost, and limiting it
  // risks 429'ing Railway's own frequent healthcheck poll into a restart loop.
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // Prometheus scrape of per-tool call/error/latency counters. Disabled (404)
  // unless LURQ_METRICS_TOKEN is set; when set, require it as a Bearer token so
  // the endpoint doesn't leak usage on a public host.
  app.get('/metrics', (req: Request, res: Response) => {
    const token = config.LURQ_METRICS_TOKEN;
    if (!token) {
      res.status(404).end();
      return;
    }
    const header = req.headers.authorization;
    const presented = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (presented !== token) {
      res.status(401).end();
      return;
    }
    res.type('text/plain').send(renderPrometheus());
  });

  // Coarse per-IP limiter to blunt unauthenticated floods before the auth lookup.
  const ipLimiter = rateLimit({
    windowMs: config.LURQ_RATE_LIMIT_WINDOW_MS,
    limit: config.LURQ_IP_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: rpcError(-32029, 'Rate limit exceeded.'),
  });

  // Bearer API-key auth: resolve and attach the key, or 401.
  const auth = async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json(rpcError(-32001, 'Missing API key. Pass Authorization: Bearer <key>.'));
      return;
    }
    try {
      const row = await lookupActiveKey(db, token);
      if (!row) {
        res.status(401).json(rpcError(-32001, 'Invalid or revoked API key.'));
        return;
      }
      req.lurqKey = row;
      next();
    } catch (err) {
      logger.error('auth lookup failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json(rpcError(-32603, 'Internal error.'));
    }
  };

  // Per-key limiter (runs after auth so it can key on the resolved API key).
  const keyLimiter = rateLimit({
    windowMs: config.LURQ_RATE_LIMIT_WINDOW_MS,
    limit: config.LURQ_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Key on the resolved API key's unique row id (always present — auth runs
    // first). The display `prefix` is only 6 chars of body, so distinct keys
    // can collide on it and share a quota; the id cannot. The IP fallback uses
    // express-rate-limit's ipKeyGenerator so IPv6 addresses are normalized
    // correctly (v8 throws ERR_ERL_KEY_GEN_IPV6 on a raw req.ip).
    keyGenerator: (req: Request) => {
      const id = (req as AuthedRequest).lurqKey?.id;
      return id != null ? `key:${id}` : ipKeyGenerator(req.ip ?? '0.0.0.0');
    },
    message: rpcError(-32029, 'Rate limit exceeded.'),
  });

  app.post('/mcp', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    // Stateless: a fresh server+transport per request, sharing the one DB pool.
    const server = buildMcpServer(db);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error('mcp request failed:', err instanceof Error ? err.message : String(err));
      if (!res.headersSent) res.status(500).json(rpcError(-32603, 'Internal error'));
    }
  });

  // Stateless server: no session GET/DELETE handling.
  app.all('/mcp', (_req: Request, res: Response) => {
    res.status(405).json(rpcError(-32000, 'Method not allowed.'));
  });

  app.listen(port, () => {
    logger.info(`lurq HTTP MCP server listening on :${port}/mcp`);
  });
}
