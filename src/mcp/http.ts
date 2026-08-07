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
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Store } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import {
  createKey,
  findKeyForOwner,
  listKeysForOwner,
  lookupActiveKey,
  revokeKey,
  rotateKey,
} from '../auth/apiKeys';
import { getOutcomesByOwner } from '../db/outcomes';
import { getContributionsByOwner } from '../db/packages';
import { deleteRepo, getRepo, listRepos, setRepoPolicy, upsertRepos } from '../db/repos';
import { getUsageByTool, getUsageSummary } from '../db/usage';
import { createDb } from '../db/client';
import { githubAppCredentials, GithubAppError } from '../github/app';
import { briefRepo } from '../github/brief';
import { computeDrift } from '../github/drift';
import { parseDepsInput, parseUpgradeRuns } from '../github/runs';
import {
  findRepoIdByFullName,
  getUpgradeImpact,
  listRunsForRepo,
  recordUpgradeRuns,
  MAX_RUNS_PER_POST,
} from '../db/upgradeRuns';
import { listInstallationRepos } from '../github/manifests';
import type { RepoPolicy } from '../github/types';
import { newFileUrl, renderWorkflow, WORKFLOW_PATH } from '../github/workflow';
import { scanOwnerRepos, scanRepo } from '../pipeline/repoScan';
import type { ApiKeyRow, RepoRow } from '../db/schema';
import { buildMcpServer } from './server';
import { renderPrometheus } from './metrics';

interface AuthedRequest extends Request {
  lurqKey?: ApiKeyRow;
}

/** JSON-RPC-shaped error envelope for HTTP-level rejections. */
function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message }, id: null };
}

/** Constant-time secret comparison (hash to a fixed length first, so length
 *  never leaks and mismatched lengths don't throw). */
export function secretEquals(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

export async function startHttpServer(opts: { port?: number } = {}): Promise<void> {
  const config = getConfig();
  const port = opts.port ?? config.PORT;

  const [{ default: express }, { default: helmet }, { rateLimit, ipKeyGenerator }] =
    await Promise.all([import('express'), import('helmet'), import('express-rate-limit')]);

  // The DB pool is the expensive resource — created once, shared by all requests.
  const { db } = createDb({ max: 20 });

  // Without Redis the response cache is a pass-through, so every recommend/
  // evaluate/compare recomputes its search on the DB — fine for one box, but the
  // first thing that buckles under real traffic. Warn loudly on the hosted path.
  if (!process.env.REDIS_URL) {
    logger.warn(
      'REDIS_URL not set — response caching is OFF; every request recomputes on the ' +
        'database. Set REDIS_URL before serving real traffic (and it also backs the ' +
        'rate limiter across instances).',
    );
  }

  // Rate-limit store: Redis-backed when REDIS_URL is set, so limits are shared
  // and correct across horizontally-scaled instances. Without it the default
  // in-memory store is per-process — fine for one box, but N instances would
  // each enforce the full quota (N× the real limit). Each limiter gets its own
  // prefix so their counters don't collide in one Redis keyspace.
  let makeStore: ((prefix: string) => Store) | null = null;
  if (process.env.REDIS_URL) {
    const [{ default: Redis }, { default: RedisStore }] = await Promise.all([
      import('ioredis'),
      import('rate-limit-redis'),
    ]);
    const rlRedis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, family: 0 });
    rlRedis.on('error', (err: Error) => logger.warn(`rate-limit redis: ${err.message}`));
    makeStore = (prefix: string) =>
      new RedisStore({
        prefix,
        sendCommand: (...args: string[]) => rlRedis.call(args[0]!, ...args.slice(1)) as Promise<never>,
      });
  }

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
    ...(makeStore ? { store: makeStore('rl:ip:') } : {}),
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
    ...(makeStore ? { store: makeStore('rl:key:') } : {}),
    message: rpcError(-32029, 'Rate limit exceeded.'),
  });

  // Dashboard-authenticated routes (§ identity): gated by the shared
  // LURQ_ISSUER_SECRET, never by a per-request API key. The Clerk-authenticated
  // web app presents the secret and supplies the signed-in user's `ownerId` in
  // the request body/query — the backend trusts the web app to have already
  // authenticated the user. NOT behind the per-IP limiter: all web-app calls
  // share one egress IP, so that would throttle every user together; the secret
  // + the web app's own per-user auth are the gate. Disabled (404) when the
  // secret is unset. This auth model never overlaps with the Bearer-API-key
  // `auth` middleware below: the two tokens live in disjoint namespaces (an
  // issued `lurq_live_...` key can never satisfy `secretEquals` against the
  // issuer secret, and the issuer secret is never looked up in `apiKeys`).
  const requireIssuerSecret = (req: Request, res: Response, next: NextFunction): void => {
    const secret = config.LURQ_ISSUER_SECRET;
    if (!secret) {
      res.status(404).end();
      return;
    }
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !secretEquals(token, secret)) {
      res.status(401).json({ error: 'Invalid issuer secret.' });
      return;
    }
    next();
  };

  // Safe DTO for the dashboard's key list — never includes keyHash.
  const toDashboardKey = (row: ApiKeyRow) => ({
    id: row.id,
    prefix: row.prefix,
    label: row.label,
    tier: row.tier,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  });

  app.post('/keys', requireIssuerSecret, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { ownerId?: unknown; label?: unknown };
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    const label = typeof body.label === 'string' ? body.label.slice(0, 200) : undefined;
    try {
      const { key, row } = await createKey(db, { ownerId, label, tier: 'free' });
      res.status(201).json({ key, prefix: row.prefix });
    } catch (err) {
      logger.error('key issuance failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not issue key.' });
    }
  });

  app.get('/keys', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      const rows = await listKeysForOwner(db, ownerId);
      res.status(200).json({ keys: rows.map(toDashboardKey) });
    } catch (err) {
      logger.error('key listing failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not list keys.' });
    }
  });

  app.post('/keys/:prefix/revoke', requireIssuerSecret, async (req: Request, res: Response) => {
    const prefix = req.params.prefix;
    const body = (req.body ?? {}) as { ownerId?: unknown };
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
    if (typeof prefix !== 'string' || !ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      const row = await findKeyForOwner(db, { prefixOrId: prefix, ownerId });
      if (!row) {
        res.status(404).json({ error: 'Key not found.' });
        return;
      }
      await revokeKey(db, String(row.id));
      res.status(200).json({ revoked: true });
    } catch (err) {
      logger.error('key revoke failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not revoke key.' });
    }
  });

  app.post('/keys/:prefix/rotate', requireIssuerSecret, async (req: Request, res: Response) => {
    const prefix = req.params.prefix;
    const body = (req.body ?? {}) as { ownerId?: unknown };
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
    if (typeof prefix !== 'string' || !ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      const row = await findKeyForOwner(db, { prefixOrId: prefix, ownerId });
      if (!row) {
        res.status(404).json({ error: 'Key not found.' });
        return;
      }
      const rotated = await rotateKey(db, String(row.id));
      if (!rotated) {
        res.status(404).json({ error: 'Key not found.' });
        return;
      }
      res.status(200).json({ key: rotated.key, prefix: rotated.row.prefix });
    } catch (err) {
      logger.error('key rotate failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not rotate key.' });
    }
  });

  app.get('/outcomes', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const limit = limitRaw && Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined;
    try {
      const rows = await getOutcomesByOwner(db, ownerId, { limit });
      res.status(200).json({
        outcomes: rows.map((row) => ({
          packageName: row.packageName,
          accepted: row.accepted,
          buildSignal: row.buildSignal,
          need: row.need,
          createdAt: row.createdAt,
        })),
      });
    } catch (err) {
      logger.error('outcomes read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read outcomes.' });
    }
  });

  app.get('/usage', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    const daysRaw = typeof req.query.days === 'string' ? Number(req.query.days) : NaN;
    const days = Number.isInteger(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
    try {
      const [summary, byTool] = await Promise.all([
        getUsageSummary(db, ownerId, days),
        getUsageByTool(db, ownerId, days),
      ]);
      res.status(200).json({ today: summary.today, series: summary.series, byTool });
    } catch (err) {
      logger.error('usage read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read usage.' });
    }
  });

  /** Autopilot impact totals for the dashboard. Not gated on the GitHub App:
   *  runs can arrive from any checkout via the CLI, connected or not. */
  app.get('/impact', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    const daysRaw = typeof req.query.days === 'string' ? Number(req.query.days) : NaN;
    const days = Number.isInteger(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
    try {
      res.status(200).json(await getUpgradeImpact(db, ownerId, days));
    } catch (err) {
      logger.error('impact read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read impact.' });
    }
  });

  app.get('/contributions', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const offsetRaw = typeof req.query.offset === 'string' ? Number(req.query.offset) : NaN;
    const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    try {
      const { total, packages: rows } = await getContributionsByOwner(db, ownerId, { limit, offset });
      res.status(200).json({ total, packages: rows });
    } catch (err) {
      logger.error('contributions read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read contributions.' });
    }
  });

  // ── Repo autopilot (dashboard-authenticated, same issuer-secret model) ──────

  /** 404 the whole surface when no GitHub App is configured, matching /keys. */
  const requireGithubApp = (_req: Request, res: Response, next: NextFunction): void => {
    if (!githubAppCredentials()) {
      res.status(404).end();
      return;
    }
    next();
  };

  /** Every repo route is owner-scoped; a missing ownerId is a 400, never a
   *  wildcard read. See the header of src/db/repos.ts. */
  const ownerFrom = (req: Request): string => {
    const source = req.method === 'GET' ? req.query : (req.body ?? {});
    const raw = (source as Record<string, unknown>).ownerId;
    return typeof raw === 'string' ? raw.trim() : '';
  };

  /** Manifests are never sent to the browser — only the derived drift summary.
   *  The dependency ranges are input to our computation, not dashboard content. */
  const toDashboardRepo = (row: RepoRow) => ({
    id: row.id,
    fullName: row.fullName,
    defaultBranch: row.defaultBranch,
    isPrivate: row.isPrivate,
    policy: row.policy,
    drift: row.drift
      ? {
          depsDeclared: row.drift.depsDeclared,
          depsTracked: row.drift.depsTracked,
          majorDrift: row.drift.majorDrift,
          anyDrift: row.drift.anyDrift,
          deprecated: row.drift.deprecated,
          advisories: row.drift.advisories,
        }
      : null,
    lastScanAt: row.lastScanAt,
    lastScanError: row.lastScanError,
  });

  /** Reject anything not matching RepoPolicy rather than merging partial input —
   *  a policy is a permission grant, and a half-parsed one could arm a repo the
   *  user meant to leave off. */
  function parsePolicy(input: unknown): RepoPolicy | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string, unknown>;
    if (typeof raw.enabled !== 'boolean') return null;
    if (typeof raw.autoMerge !== 'boolean') return null;
    if (raw.scope !== 'security' && raw.scope !== 'blocking' && raw.scope !== 'all') return null;
    return { enabled: raw.enabled, scope: raw.scope, autoMerge: raw.autoMerge };
  }

  app.post('/repos/connect', requireIssuerSecret, requireGithubApp, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const installationRaw = (req.body ?? {}).installationId;
    const installationId = Number(installationRaw);
    if (!ownerId || !Number.isInteger(installationId) || installationId <= 0) {
      res.status(400).json({ error: 'ownerId and installationId are required.' });
      return;
    }
    try {
      const found = await listInstallationRepos(installationId);
      const connected = await upsertRepos(
        db,
        found.map((repo) => ({
          ownerId,
          installationId,
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch,
          isPrivate: repo.isPrivate,
        })),
      );
      // Respond as soon as the repos are registered. A first scan of a large
      // account is minutes of GitHub calls, and holding the connect request open
      // for it would time out at the edge and look like a failed install.
      void scanOwnerRepos(db, ownerId).catch((err: unknown) => {
        logger.warn(`initial repo scan failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      res.status(200).json({ connected });
    } catch (err) {
      const status = err instanceof GithubAppError ? err.status : 502;
      logger.error('repo connect failed:', err instanceof Error ? err.message : String(err));
      res.status(status).json({ error: 'Could not read the GitHub installation.' });
    }
  });

  app.get('/repos', requireIssuerSecret, requireGithubApp, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      const rows = await listRepos(db, ownerId);
      res.status(200).json({ repos: rows.map(toDashboardRepo) });
    } catch (err) {
      logger.error('repo list failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not list repos.' });
    }
  });

  app.get('/repos/:id', requireIssuerSecret, requireGithubApp, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const id = Number(req.params.id);
    if (!ownerId || !Number.isInteger(id)) {
      res.status(400).json({ error: 'ownerId and a numeric id are required.' });
      return;
    }
    try {
      const row = await getRepo(db, ownerId, id);
      if (!row) {
        res.status(404).json({ error: 'Repo not found.' });
        return;
      }
      const runs = await listRunsForRepo(db, ownerId, row.id);
      // The setup file is rendered per repo because it carries that repo's own
      // package manager and armed state. Shipped as text so the dashboard can
      // show exactly what will be committed before anything is.
      const workflow = renderWorkflow({
        installCommand: row.installCommand ?? undefined,
        armed: row.policy.enabled,
      });
      res.status(200).json({
        repo: {
          ...toDashboardRepo(row),
          deps: row.drift?.deps ?? [],
          runs,
          workflow,
          workflowPath: WORKFLOW_PATH,
          setupUrl: newFileUrl(row.fullName, row.defaultBranch ?? 'main', workflow),
        },
      });
    } catch (err) {
      logger.error('repo read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read repo.' });
    }
  });

  app.get('/repos/:id/brief', requireIssuerSecret, requireGithubApp, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const id = Number(req.params.id);
    if (!ownerId || !Number.isInteger(id)) {
      res.status(400).json({ error: 'ownerId and a numeric id are required.' });
      return;
    }
    try {
      const row = await getRepo(db, ownerId, id);
      if (!row) {
        res.status(404).json({ error: 'Repo not found.' });
        return;
      }
      res.status(200).json(await briefRepo(db, row.drift ?? null));
    } catch (err) {
      logger.error('repo brief failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not build the migration brief.' });
    }
  });

  app.post('/repos/:id/scan', requireIssuerSecret, requireGithubApp, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const id = Number(req.params.id);
    if (!ownerId || !Number.isInteger(id)) {
      res.status(400).json({ error: 'ownerId and a numeric id are required.' });
      return;
    }
    try {
      const row = await getRepo(db, ownerId, id);
      if (!row) {
        res.status(404).json({ error: 'Repo not found.' });
        return;
      }
      // One repo is a handful of GitHub calls — fast enough to await, so the
      // dashboard can render the new numbers instead of polling for them.
      const result = await scanRepo(db, row);
      res.status(200).json({ result });
    } catch (err) {
      logger.error('repo scan failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not scan repo.' });
    }
  });

  app.patch('/repos/:id', requireIssuerSecret, requireGithubApp, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const id = Number(req.params.id);
    const policy = parsePolicy((req.body ?? {}).policy);
    if (!ownerId || !Number.isInteger(id) || !policy) {
      res.status(400).json({ error: 'ownerId, a numeric id, and a complete policy are required.' });
      return;
    }
    try {
      const updated = await setRepoPolicy(db, ownerId, id, policy);
      if (!updated) {
        res.status(404).json({ error: 'Repo not found.' });
        return;
      }
      res.status(200).json({ policy });
    } catch (err) {
      logger.error('repo policy update failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not update policy.' });
    }
  });

  app.delete('/repos/:id', requireIssuerSecret, requireGithubApp, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const id = Number(req.params.id);
    if (!ownerId || !Number.isInteger(id)) {
      res.status(400).json({ error: 'ownerId and a numeric id are required.' });
      return;
    }
    try {
      const removed = await deleteRepo(db, ownerId, id);
      res.status(removed ? 200 : 404).json(removed ? { removed: true } : { error: 'Repo not found.' });
    } catch (err) {
      logger.error('repo delete failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not disconnect repo.' });
    }
  });

  // ── Autopilot CI surface (API-key authenticated, same as /mcp) ─────────────
  //
  // These two are what the user's GitHub Actions workflow calls. They are keyed
  // on the API key, NOT the issuer secret: the workflow is the user's own
  // machine, so it holds a per-user key and never the web↔backend shared secret.
  //
  // Note there is no repo id in either path. The workflow sends the manifest it
  // already has on disk, so `upgrade-plan` works in any checkout — connecting a
  // repo to the dashboard adds visibility, it is not a precondition for the loop.

  app.post('/upgrade-plan', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    const deps = parseDepsInput((req.body ?? {}).deps);
    if (Object.keys(deps).length === 0) {
      res.status(400).json({ error: 'deps is required: { "package": "range", … }' });
      return;
    }
    try {
      const drift = await computeDrift(db, [{ path: 'package.json', deps }]);
      const brief = await briefRepo(db, drift);
      res.status(200).json({
        ...brief,
        // Surfaced so CI can log what lurq had no opinion on. An upgrade we do
        // not know about must not look like an upgrade we cleared.
        untracked: Object.keys(deps).length - drift.depsTracked,
      });
    } catch (err) {
      logger.error('upgrade plan failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not build the upgrade plan.' });
    }
  });

  app.post('/upgrade-runs', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    const ownerId = (req as AuthedRequest).lurqKey?.ownerId ?? null;
    if (!ownerId) {
      // Operator-issued keys have no dashboard account to attribute runs to.
      res.status(403).json({ error: 'This key has no account attached.' });
      return;
    }
    const { runs, rejected } = parseUpgradeRuns((req.body ?? {}).runs, MAX_RUNS_PER_POST);
    if (runs.length === 0) {
      res.status(400).json({ error: 'runs must be a non-empty array of upgrade results.' });
      return;
    }
    try {
      // Resolve repo links once per distinct repo, not once per run.
      const repoIds = new Map<string, number | null>();
      for (const run of runs) {
        if (!repoIds.has(run.repoFullName)) {
          repoIds.set(run.repoFullName, await findRepoIdByFullName(db, ownerId, run.repoFullName));
        }
      }
      const recorded = await recordUpgradeRuns(
        db,
        runs.map((run) => ({ ...run, ownerId, repoId: repoIds.get(run.repoFullName) ?? null })),
      );
      res.status(200).json({ recorded, rejected });
    } catch (err) {
      logger.error('upgrade run record failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not record the upgrade runs.' });
    }
  });

  app.post('/mcp', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    // Stateless: a fresh server+transport per request, sharing the one DB pool.
    // Thread the authenticated key's owner identity into the tools (§3.1).
    const server = buildMcpServer(db, { ownerId: (req as AuthedRequest).lurqKey?.ownerId ?? null });
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
