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
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Store } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import { capture, flush as flushAnalytics } from '../core/analytics';
import { formatError } from '../core/errors';
import { CAPABILITIES, searchCapabilities } from '../core/capabilities';
import {
  createKey,
  findKeyForOwner,
  hasScope,
  listKeysForOwner,
  lookupActiveKey,
  parseScopes,
  revokeKey,
  rotateKey,
} from '../auth/apiKeys';
import { getOutcomesByOwner } from '../db/outcomes';
import { getContributionsByOwner } from '../db/packages';
import { listAlerts } from '../db/alerts';
import {
  deleteRepo,
  deleteReposByInstallation,
  findPolicyByFullName,
  getRepo,
  listRepos,
  ownerForInstallation,
  setRepoPolicy,
  upsertRepos,
} from '../db/repos';
import {
  getSelectionPolicy,
  listPolicyChanges,
  setSelectionPolicy,
  summarizeDecisions,
} from '../db/selectionPolicy';
import { validateSelectionPolicy } from '../policy/parse';
import { repoConformance } from '../policy/conformance';
import { getUsageByTool, getUsageSummary, recordUsage } from '../db/usage';
import {
  entitlementFor,
  isAllowed,
  getSubscription,
  type Entitlement,
} from '../db/subscriptions';
import {
  billingEnabled,
  createCheckoutSession,
  isCheckoutOrigin,
  createPortalSession,
} from '../billing/stripe';
import { GRACE_CALLS_PER_DAY, PLANS, type Tier } from '../core/plans';
import { agentClient, initializeInfo } from './clientInfo';
import { registerPublicPackageRoutes } from './publicPackages';
import { registerPublicUpgradeRoutes } from './publicUpgrades';
import { createDb } from '../db/client';
import { githubAppCredentials, GithubAppError } from '../github/app';
import { briefRepo } from '../github/brief';
import { computeDrift } from '../github/drift';
import { addAskSpend, getAskSpendToday } from '../db/askSpend';
import { applyScope } from '../github/scope';
import { parseDepsInput, parseRepoFullName, parseUpgradeRuns } from '../github/runs';
import {
  findRepoIdByFullName,
  getUpgradeImpact,
  listRunsForRepo,
  recordUpgradeRuns,
  MAX_RUNS_PER_POST,
} from '../db/upgradeRuns';
import { listInstallationRepos } from '../github/manifests';
import { builderProfile, type BuilderProfile } from '../github/builderProfile';
import { GitHubUnavailableError, parseTarget, publicScan, type PublicScan } from '../github/publicScan';
import type { RepoPolicy } from '../github/types';
import { parseWebhook, verifyWebhookSignature } from '../github/webhook';
import { newFileUrl, renderWorkflow, WORKFLOW_PATH } from '../github/workflow';
import { byRecentPush, scanRepo, scanRepos } from '../pipeline/repoScan';
import type { ApiKeyRow, RepoRow } from '../db/schema';
import { buildMcpServer } from './server';
import { callDashboardTool, DASHBOARD_TOOLS, listDashboardTools } from './dashboardTools';
import { MCP_SCAN_BODY_LIMIT, MCP_SCAN_UPLOAD_PATH, registerMcpScanRoutes } from './mcpScanRoutes';
import { registerNotificationRoutes } from './notificationRoutes';
import { registerChannelRoutes } from './channelRoutes';
import { registerBuilderScanRoutes } from './builderScanRoutes';
import { secretKey } from '../core/secretBox';
import { channelsAllowed } from '../notify/channelRun';
import { postJson } from '../notify/safeHttp';
import { agentAlertNotice } from '../notify/sources';
import { PACKAGE_NAME } from '../core/constants';
import { renderPrometheus } from './metrics';
import { alert, errorKind } from '../core/alert';
import { processStripeWebhook } from '../billing/webhook';

interface AuthedRequest extends Request {
  lurqKey?: ApiKeyRow;
  entitlement?: Entitlement;
}

/** Raw request bytes, kept by the JSON parser for webhook signature checks. */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/** JSON-RPC-shaped error envelope for HTTP-level rejections. */
function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message }, id: null };
}

/** The next step for a caller with no working key, appended to both 401s. */
export const GET_A_KEY =
  'Get a key at https://www.lurq.run/dashboard/keys, or run `npx lurqrun` to set one up.';

/** One cached public scan: the answer, when it was taken, and how long it holds. */
export interface ScanCacheEntry {
  at: number;
  ttl: number;
  value: PublicScan | null;
}

/** The same entry for a builder profile, which holds several scans. */
type ProfileCacheEntry = Omit<ScanCacheEntry, 'value'> & { value: BuilderProfile | null };

/** A settled answer: every declared dependency was already in the index. */
const SCAN_TTL_MS = 15 * 60_000;
/**
 * A PROVISIONAL answer, and the reason this is two constants rather than one.
 *
 * A scan of an unindexed repo queues its dependencies for ingestion, which
 * finishes in seconds, and then tells the visitor to try again in a few
 * minutes — while the fifteen-minute cache served them the same empty result
 * for the rest of the quarter hour. The advice was correct and the cache made
 * it a lie. Anything that queued work, and any target we could not read at all,
 * is held only long enough to blunt a refresh loop.
 */
const SCAN_PROVISIONAL_TTL_MS = 45_000;
/** Bounded so a spray of one-off targets cannot grow the map without limit. */
const SCAN_CACHE_MAX = 500;

/**
 * How long this particular answer stays true.
 *
 * A miss is provisional because the repo may be about to exist, be made public,
 * or gain a package.json. A partial read is provisional because the ingest
 * queue is, at that moment, making it less partial.
 */
export function scanTtl(scan: PublicScan | null): number {
  if (!scan) return SCAN_PROVISIONAL_TTL_MS;
  return scan.depsTracked < scan.depsDeclared ? SCAN_PROVISIONAL_TTL_MS : SCAN_TTL_MS;
}

/** A builder profile holds only as long as its least settled repo. */
export function profileTtl(profile: BuilderProfile | null): number {
  if (!profile) return SCAN_PROVISIONAL_TTL_MS;
  // Repos GitHub did not answer for: the next read may get them, so hold briefly.
  if (profile.coverage?.unreadManifests.length) return SCAN_PROVISIONAL_TTL_MS;
  return Math.min(SCAN_TTL_MS, ...profile.repos.map(scanTtl));
}

/**
 * Make room without wiping the cache.
 *
 * `clear()` at the cap meant one unlucky request cost every other cached repo
 * its entry, so a busy minute re-scanned everything it had already answered.
 * Drop what has expired first, and only then the oldest entries — a Map
 * iterates in insertion order, so that is the front of it.
 */
export function evictScans<T extends { at: number; ttl: number }>(
  cache: Map<string, T>,
  max = SCAN_CACHE_MAX,
): void {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= v.ttl) cache.delete(k);
  for (const k of cache.keys()) {
    if (cache.size < max) break;
    cache.delete(k);
  }
}

/** What body-parser and friends attach to the errors they throw. */
type RequestError = Error & { status?: number; type?: string };

/**
 * Turn a thrown request error into the envelope the addressed surface speaks.
 *
 * Exported for its own sake: this is the branch that decides whether a caller
 * gets a readable reason or a shrug, and it is worth a test that does not need
 * a listening server and a database to run.
 *
 * `/mcp` speaks JSON-RPC and everything else speaks `{ error }`. Getting this
 * wrong is how the default Express handler used to answer a malformed body with
 * an HTML page: lurq's own client parses the reply as JSON-RPC, found nothing,
 * and reported a bare "failed with HTTP 400" — no reason, in the one case where
 * the reason is the entire diagnosis.
 *
 * Only body-parser faults (`type` starting `entity.`) get their cause echoed.
 * Any other throw is an unexpected server fault whose message may name internals,
 * so it collapses to "Internal error." and goes to the log instead.
 */
export function errorEnvelope(
  err: RequestError,
  path: string,
): { status: number; body: unknown; clientFault: boolean } {
  const clientFault = typeof err.type === 'string' && err.type.startsWith('entity.');
  const status =
    typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message = clientFault
    ? err.type === 'entity.too.large'
      ? 'Request body too large (limit 1mb).'
      : 'Request body is not valid JSON.'
    : 'Internal error.';
  const body =
    path === '/mcp'
      ? // -32700 is JSON-RPC's own "parse error"; -32603 is "internal error".
        rpcError(clientFault ? -32700 : -32603, message)
      : { error: message };
  return { status, body, clientFault };
}

/**
 * MCP methods that describe the server and run nothing: the handshake, a ping,
 * and the list calls. Registries, directories and inspectors (Smithery, Glama,
 * the MCP Inspector) call exactly these to show what lurq offers, and they do it
 * without anyone's API key.
 */
export const DISCOVERY_METHODS: ReadonlySet<string> = new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
]);

/**
 * May this `/mcp` request be served without a key?
 *
 * Only when it carries no Authorization header at all and every JSON-RPC message
 * in it is a discovery method. The tool list is already public (the README
 * prints it), so describing the server gives nothing away; anything that runs a
 * tool, a `tools/call` included, still needs a key. A request that sends a
 * header, even an empty or wrong one, takes the authenticated path and gets that
 * path's precise error rather than silently becoming anonymous.
 */
export function isAnonymousDiscovery(authorization: string | undefined, body: unknown): boolean {
  if (authorization !== undefined) return false;
  const messages = Array.isArray(body) ? body : [body];
  return (
    messages.length > 0 &&
    messages.every((m) => {
      const method = (m as { method?: unknown } | null)?.method;
      return typeof method === 'string' && DISCOVERY_METHODS.has(method);
    })
  );
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
  const { db, close: closeDb } = createDb({ max: 20 });

  // Without Redis the response cache is a pass-through, so every recommend/
  // evaluate/compare recomputes its search on the DB — fine for one box, but the
  // first thing that buckles under real traffic. Warn loudly on the hosted path.
  if (!process.env.REDIS_URL) {
    logger.warn(
      'REDIS_URL not set, response caching is OFF; every request recomputes on the ' +
        'database. Set REDIS_URL before serving real traffic (and it also backs the ' +
        'rate limiter across instances).',
    );
  }

  // The public scan resolves a bare profile through api.github.com, whose
  // unauthenticated budget is 60 requests an hour FOR THE WHOLE SERVER. One
  // visitor typing usernames exhausts it for everybody, and the failure looks
  // like "no public package.json found for that" rather than like a quota. A
  // token lifts the same calls to 5,000/hour.
  if (!config.GITHUB_TOKEN) {
    logger.warn(
      'GITHUB_TOKEN not set; /scan/public resolves profiles on the anonymous ' +
        'GitHub budget (60/hour, server-wide) and will start reporting readable ' +
        'repositories as unreadable once it runs out.',
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
        sendCommand: (...args: string[]) =>
          rlRedis.call(args[0]!, ...args.slice(1)) as Promise<never>,
      });
  }

  const app = express();
  app.set('trust proxy', 1); // Railway terminates TLS at the edge.
  app.use(helmet());
  // Operator alert on any 5xx, whichever route produced it: most routes catch
  // their own failures and answer 500 themselves, so the terminal error handler
  // alone would miss nearly all of them. On `finish`, so it runs after the
  // response is out and cannot slow or fail it. The route pattern rather than
  // the path keeps ids out of the message. The two webhooks alert with their own
  // detail, so they are skipped here rather than reported twice.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      if (res.statusCode < 500 || req.path === '/billing/webhook') return;
      const route = (req.route as { path?: unknown } | undefined)?.path;
      alert('server-error', `${req.method} ${typeof route === 'string' ? route : req.path} answered ${res.statusCode}`);
    });
    next();
  });
  // `verify` keeps the bytes the parser already had in hand. GitHub signs the raw
  // body, and a re-serialized parse result is not byte-identical, so the webhook
  // signature is uncheckable without this. Costs a reference, not a copy.
  const jsonBody = express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = buf;
    },
  });
  // Scan uploads carry whole tool contracts and parse their own body, with a
  // larger ceiling and only after auth (see mcpScanRoutes). Every other route
  // keeps the 1mb limit.
  app.use((req, res, next) => (req.path === MCP_SCAN_UPLOAD_PATH ? next() : jsonBody(req, res, next)));

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
    // secretEquals, not `!==`: `===` on strings short-circuits at the first
    // differing byte, which leaks the token prefix-by-prefix to anyone willing
    // to time the responses. The issuer-secret check below already does this;
    // this endpoint is guarded by a shared secret of exactly the same kind and
    // has no reason to be the weaker one.
    if (!secretEquals(presented, token)) {
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

  // The capability catalog, for the dashboard's search palette. Public and
  // unauthenticated on purpose: it is a static description of the product —
  // the same list the docs print — and holds nothing about any account. Behind
  // the IP limiter only, since it costs no backend work at all.
  // Public, keyless package summaries for the lurq.run/npm pages. Behind the IP
  // limiter only; publicPackages.ts keeps them to a summary of the top packages.
  registerPublicPackageRoutes(app, db, ipLimiter);
  registerPublicUpgradeRoutes(app, db, ipLimiter);

  app.get('/capabilities', ipLimiter, (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = Math.min(Number(req.query.limit) || 6, CAPABILITIES.length);
    res.json({ capabilities: q ? searchCapabilities(q, limit) : CAPABILITIES });
  });

  /**
   * Scan a public repo or profile for anyone, signed in or not.
   *
   * The only unauthenticated route that touches the database, and it exists
   * because the funnel was the wrong way round: the fastest way to explain what
   * lurq does is to show someone their own dependencies, and that was gated
   * behind a signup and a GitHub App install. This is the top of the funnel.
   *
   * Three things keep it from being a free scan API. It has a limiter of its
   * own, far tighter than the coarse IP limit the other unauthenticated routes
   * share; the result is capped to a handful of dependency rows, so the full
   * report is still a reason to sign up; and identical targets are served from
   * memory, so a refresh loop costs one scan rather than one per press.
   */
  const scanCache = new Map<string, ScanCacheEntry>();

  /**
   * The scan route's own limiter, ahead of the coarse one.
   *
   * One scan reads GitHub over a budget shared by every visitor, runs a
   * handful of indexed queries, and queues an ingest per unknown dependency.
   * At the coarse limit that is 240 of those a minute from a single IP, and
   * the web app's 6-a-minute hop does not apply to anyone calling this
   * endpoint directly. Redis-backed when REDIS_URL is set, so the ceiling is
   * the real one rather than per-instance.
   *
   * The body is `{ error }` rather than a JSON-RPC envelope: this route speaks
   * plain JSON to a browser, and the landing page renders `error` directly.
   */
  const scanLimiter = rateLimit({
    windowMs: config.LURQ_RATE_LIMIT_WINDOW_MS,
    limit: config.LURQ_SCAN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? '0.0.0.0'),
    ...(makeStore ? { store: makeStore('rl:scan:') } : {}),
    message: { error: "That's a lot of scans. Give it a minute." },
  });

  app.post('/scan/public', ipLimiter, scanLimiter, async (req: Request, res: Response) => {
    const raw = (req.body ?? {}) as { target?: unknown };
    const target = typeof raw.target === 'string' ? parseTarget(raw.target) : null;
    if (!target) {
      res.status(400).json({ error: 'Give a GitHub repo (owner/name) or a profile.' });
      return;
    }

    const key = target.kind === 'repo' ? `${target.owner}/${target.name}` : `@${target.login}`;
    const hit = scanCache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) {
      if (!hit.value) {
        res.status(404).json({ error: 'No public package.json found for that.' });
        return;
      }
      res.json(hit.value);
      return;
    }

    try {
      const scan = await publicScan(db, target);
      if (scanCache.size >= SCAN_CACHE_MAX) evictScans(scanCache);
      scanCache.set(key, { at: Date.now(), ttl: scanTtl(scan), value: scan });
      if (!scan) {
        res.status(404).json({ error: 'No public package.json found for that.' });
        return;
      }
      res.json(scan);
    } catch (err) {
      logger.error('public scan failed:', formatError(err));
      res.status(502).json({ error: 'Could not read that repository.' });
    }
  });

  /**
   * The builder report behind /dashboard/report: a GitHub profile's archetype,
   * trait scores and up to six stack scans. A larger /scan/public, so it shares
   * that route's limiter and the shape of its cache.
   *
   * Returns the WHOLE profile. The web hop cuts it down for signed-out visitors;
   * builderProfile.ts says why it is never computed smaller. Everything in it is
   * public GitHub and npm data, so the cut is a conversion boundary, not a
   * security one, and anyone calling this directly is held by `scanLimiter`.
   */
  const profileCache = new Map<string, ProfileCacheEntry>();

  app.post('/scan/profile', ipLimiter, scanLimiter, async (req: Request, res: Response) => {
    const raw = (req.body ?? {}) as { target?: unknown };
    const target = typeof raw.target === 'string' ? parseTarget(raw.target) : null;
    if (!target) {
      res.status(400).json({ error: 'Give a GitHub username or a repo (owner/name).' });
      return;
    }

    // A typed repo profiles its owner, with that repo read first.
    const login = target.kind === 'repo' ? target.owner : target.login;
    const featured = target.kind === 'repo' ? target.name : undefined;
    // GitHub logins and repo names are case-insensitive, so the cache is too.
    const key = `${login}/${featured ?? ''}`.toLowerCase();
    const missing = () => res.status(404).json({ error: 'No public GitHub profile found for that.' });

    const hit = profileCache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) {
      if (!hit.value) missing();
      else res.json(hit.value);
      return;
    }

    try {
      const profile = await builderProfile(db, login, featured);
      if (profileCache.size >= SCAN_CACHE_MAX) evictScans(profileCache);
      profileCache.set(key, { at: Date.now(), ttl: profileTtl(profile), value: profile });
      if (!profile) missing();
      else res.json(profile);
    } catch (err) {
      if (err instanceof GitHubUnavailableError) {
        // Not cached: the next request may get through, and a cached failure
        // would turn one rate-limited minute into a quarter hour of "try again".
        logger.warn(`profile scan: ${err.message}`);
        res.status(503).json({
          error: "GitHub didn't answer (a rate limit or a timeout), so nothing could be read. Try again in a minute.",
        });
        return;
      }
      logger.error('profile scan failed:', formatError(err));
      res.status(502).json({ error: 'Could not read that profile.' });
    }
  });

  // Bearer API-key auth: resolve and attach the key, or 401.
  //
  // The 401 text is usually the first thing a new user sees, pasted from their
  // agent's MCP log, so it says where a key comes from. Deliberately no
  // WWW-Authenticate header: lurq has no OAuth, and MCP clients that see one
  // start OAuth discovery and bury this message under a failed sign-in flow.
  const auth = async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json(rpcError(-32001, `Missing API key. Pass Authorization: Bearer <key>. ${GET_A_KEY}`));
      return;
    }
    try {
      const row = await lookupActiveKey(db, token);
      if (!row) {
        res.status(401).json(rpcError(-32001, `Invalid or revoked API key. ${GET_A_KEY}`));
        return;
      }
      req.lurqKey = row;
      next();
    } catch (err) {
      logger.error('auth lookup failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json(rpcError(-32603, 'Internal error.'));
    }
  };

  /**
   * Monthly quota, resolved once per request after auth.
   *
   * Cached for a minute per account. The lookup is two indexed queries, which is
   * cheap once and silly on every tool call from an agent running a batch; a
   * minute of staleness means someone who just upgraded may spend up to sixty
   * more seconds on the old plan, and someone who has exhausted their quota may
   * get a handful of extra calls. Both are the right direction to be wrong in.
   * The webhook clears the entry on upgrade so the common case is instant.
   */
  const entitlementCache = new Map<string, { at: number; value: Entitlement }>();
  const ENTITLEMENT_TTL_MS = 60_000;

  const invalidateEntitlement = (ownerId: string) => entitlementCache.delete(ownerId);

  const resolveEntitlement = async (ownerId: string | null): Promise<Entitlement> => {
    if (!ownerId) return entitlementFor(db, null);
    const hit = entitlementCache.get(ownerId);
    if (hit && Date.now() - hit.at < ENTITLEMENT_TTL_MS) return hit.value;
    const value = await entitlementFor(db, ownerId);
    entitlementCache.set(ownerId, { at: Date.now(), value });
    return value;
  };

  // Per-key limiter (runs after auth so it can key on the resolved API key).
  const keyLimiter = rateLimit({
    windowMs: config.LURQ_RATE_LIMIT_WINDOW_MS,
    // The burst ceiling is the plan's, not one number for everybody. Read from
    // the cached entitlement when `quota` has already resolved it on a previous
    // request for this key, and otherwise from LURQ_RATE_LIMIT_MAX — the limiter
    // runs BEFORE `quota` in the chain, so the first request of a minute is
    // metered at the configured default and the rest at the plan's rate. Paying
    // for Enterprise should not leave you sharing the free tier's burst.
    limit: (req: Request) => {
      const ownerId = (req as AuthedRequest).lurqKey?.ownerId;
      const cached = ownerId ? entitlementCache.get(ownerId) : undefined;
      return cached?.value.plan.ratePerMinute ?? config.LURQ_RATE_LIMIT_MAX;
    },
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

  /**
   * Enforce the plan's monthly allowance. Runs after `auth`, before the tool.
   *
   * 402 rather than 429: the caller is not going too fast, they are out of
   * allowance until the month turns, and a retry-after has nothing useful to say.
   * The body names the plan, the limit and where to change it, because an agent
   * relaying this to a developer should be relaying something actionable.
   *
   * Fails OPEN. If the entitlement lookup itself errors, the request is served:
   * a Postgres hiccup must not read as "your subscription is invalid" to every
   * paying customer at once. Over-serving during an outage is recoverable;
   * locking out the paid tier is the incident.
   */
  /**
   * One line for the agent, appended to tool results past the pool. A header is
   * invisible to a model reading a tool result; this is what gets relayed to the
   * developer, which is the only way an over-limit account learns it is one.
   */
  const quotaNotice = (ent: Entitlement | undefined): string | null => {
    if (!ent || ent.withinQuota) return null;
    if (ent.inOverage) {
      return `lurq: this account is past its ${ent.limit} included calls this month; further calls are billed as ${ent.plan.name} overage.`;
    }
    if (ent.inGrace) {
      return `lurq: monthly limit reached (${ent.used}/${ent.limit} calls). A few grace calls a day remain until the month turns. Tell the user they can upgrade at ${config.LURQ_WEB_URL}/dashboard/billing`;
    }
    return null;
  };

  const quota = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authed = req as AuthedRequest;
    const ownerId = authed.lurqKey?.ownerId ?? null;
    try {
      const ent = await resolveEntitlement(ownerId);
      authed.entitlement = ent;
      if (!isAllowed(ent)) {
        res
          .status(402)
          .json(
            rpcError(
              -32002,
              `Monthly limit reached for the ${ent.plan.name} plan ` +
                `(${ent.used}/${ent.limit} calls), and today's ${GRACE_CALLS_PER_DAY} grace calls are spent. ` +
                `It resets when the month turns. Upgrade at ${config.LURQ_WEB_URL}/dashboard/billing`,
            ),
          );
        return;
      }
      // Over the allowance but inside the daily grace: served, and marked so a
      // client reading headers can say why it is about to stop.
      if (ent.inOverage) res.setHeader('X-Lurq-Quota', 'overage');
      else if (ent.inGrace) res.setHeader('X-Lurq-Quota', 'grace');
      next();
    } catch (err) {
      logger.error(
        'quota lookup failed, serving anyway:',
        err instanceof Error ? err.message : String(err),
      );
      next();
    }
  };

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
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  });

  // ── Billing (§ Stripe) ─────────────────────────────────────────────────────
  // Checkout and portal are issuer-secret routes: the web app asks on behalf of
  // a Clerk-authenticated user and never holds a Stripe credential itself. The
  // webhook authenticates by Stripe's own signature instead, since Stripe is the
  // caller and knows nothing about our issuer secret.

  app.post('/billing/checkout', requireIssuerSecret, async (req: Request, res: Response) => {
    if (!billingEnabled()) {
      res.status(404).end();
      return;
    }
    const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';
    const tier = typeof req.body?.tier === 'string' ? (req.body.tier as Tier) : 'pro';
    const email = typeof req.body?.email === 'string' ? req.body.email : null;
    const interval = req.body?.interval === 'year' ? 'year' : 'month';
    const from = isCheckoutOrigin(req.body?.from) ? req.body.from : undefined;
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    if (!(tier in PLANS) || !PLANS[tier].paid) {
      res.status(400).json({ error: `${tier} is not a purchasable plan.` });
      return;
    }
    try {
      const url = await createCheckoutSession(db, { ownerId, tier, interval, email, from });
      if (!url) {
        res.status(503).json({ error: 'That plan is not available for checkout yet.' });
        return;
      }
      res.status(200).json({ url });
    } catch (err) {
      logger.error('checkout failed:', formatError(err));
      res.status(502).json({ error: 'Could not start checkout.' });
    }
  });

  app.post('/billing/portal', requireIssuerSecret, async (req: Request, res: Response) => {
    if (!billingEnabled()) {
      res.status(404).end();
      return;
    }
    const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      const url = await createPortalSession(db, ownerId);
      if (!url) {
        res.status(404).json({ error: 'No billing account for this user yet.' });
        return;
      }
      res.status(200).json({ url });
    } catch (err) {
      logger.error('portal failed:', formatError(err));
      res.status(502).json({ error: 'Could not open the billing portal.' });
    }
  });

  /** What the dashboard renders: the plan, its state, and the month so far. */
  /**
   * Daily Ask ceiling for one account, in micro-dollars: the plan's
   * `askDailyUsd` (core/plans.ts), so asking more is a reason to upgrade rather
   * than a cost absorbed on every free account. plans.ts is the only place the
   * number lives; to turn Ask off everywhere, unset the web app's Anthropic key.
   *
   * Floored at one micro-dollar because the web route reads a zero limit as
   * "no limit".
   */
  const askLimit = async (ownerId: string): Promise<{ micros: number; tier: string }> => {
    const { plan } = await resolveEntitlement(ownerId);
    return { micros: Math.max(1, Math.round(plan.askDailyUsd * 1_000_000)), tier: plan.tier };
  };

  /** One call may not move the ledger by more than this, so a caller bug is a
   *  wrong number rather than a bottomless credit. Four times a question's reserve. */
  const ASK_DELTA_MAX_MICROS = 1_000_000;

  /**
   * The Ask budget, read and written by the dashboard's /api/ask.
   *
   * Lives here rather than in the web app because the web app has no database —
   * and because an in-process ledger is per-instance and resets on cold start,
   * which caps a burst but never a day. This is the copy that holds.
   *
   * The ceiling is served alongside the total rather than hardcoded in the web
   * app: the limit is a product decision that will change, and it should change
   * in one place that the thing enforcing it reads.
   */
  app.get('/ask-budget', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      const [spentMicros, limit] = await Promise.all([
        getAskSpendToday(db, ownerId),
        askLimit(ownerId),
      ]);
      res.status(200).json({ spentMicros, limitMicros: limit.micros });
    } catch (err) {
      // Deliberately a 500, not a zero. A caller that cannot read the ledger
      // must fail closed, and it can only do that if this says "unknown"
      // instead of "nothing spent".
      logger.error('ask budget read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read the Ask budget.' });
    }
  });

  app.post('/ask-budget', requireIssuerSecret, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { ownerId?: unknown; usdMicros?: unknown; answered?: unknown };
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
    const micros = Number(body.usdMicros);
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    // Signed: a caller reserves its worst case up front and refunds the unused
    // part after, so a refund is a legitimate negative. Bounded either way.
    if (!Number.isFinite(micros) || Math.abs(micros) > ASK_DELTA_MAX_MICROS) {
      res.status(400).json({ error: 'usdMicros must be a finite delta of at most $1.' });
      return;
    }
    try {
      const [spentMicros, limit] = await Promise.all([
        addAskSpend(db, ownerId, Math.round(micros)),
        askLimit(ownerId),
      ]);
      res.status(200).json({ spentMicros, limitMicros: limit.micros });

      // Product analytics: numbers and a model id only, never the question, so
      // the privacy page's promise holds. Picked field by field — the caller is
      // trusted (issuer secret) but its body is not shaped.
      const a = body.answered;
      if (a && typeof a === 'object') {
        const r = a as Record<string, unknown>;
        capture(ownerId, 'ask_answered', {
          tier: limit.tier,
          model: typeof r.model === 'string' ? r.model.slice(0, 64) : null,
          turns: Number(r.turns) || 0,
          usd: Number(r.usd) || 0,
          cacheReadTokens: Number(r.cacheReadTokens) || 0,
        });
      }
      // The conversion signal: a reserve that crossed the plan's ceiling is
      // exactly the question the web route is about to refuse.
      if (micros > 0 && spentMicros > limit.micros) {
        capture(ownerId, 'ask_limit_hit', { tier: limit.tier });
      }
    } catch (err) {
      logger.error('ask budget write failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not record Ask spend.' });
    }
  });

  app.get('/billing/subscription', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      const [sub, ent] = await Promise.all([
        getSubscription(db, ownerId),
        entitlementFor(db, ownerId),
      ]);
      res.status(200).json({
        tier: ent.plan.tier,
        planName: ent.plan.name,
        status: sub?.status ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        used: ent.used,
        limit: ent.limit,
        seats: ent.seats,
        interval: sub?.billingInterval ?? null,
        billingEnabled: billingEnabled(),
        manageable: Boolean(sub?.stripeCustomerId),
      });
    } catch (err) {
      logger.error('subscription read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read the subscription.' });
    }
  });

  /**
   * Stripe's webhook. Signature-authenticated, so it is deliberately NOT behind
   * requireIssuerSecret or the IP limiter: Stripe calls it from its own ranges
   * and a burst of retries must not be throttled into looking like an outage.
   *
   * Processes before answering, and answers 5xx when processing fails so Stripe
   * retries. The status contract lives in billing/webhook.ts.
   */
  app.post('/billing/webhook', async (req: Request, res: Response) => {
    const signature = req.headers['stripe-signature'];
    const reply = await processStripeWebhook(
      db,
      (req as RawBodyRequest).rawBody,
      typeof signature === 'string' ? signature : undefined,
      invalidateEntitlement,
    );
    if (reply.body === undefined) res.status(reply.status).end();
    else res.status(reply.status).json(reply.body);
  });

  app.post('/keys', requireIssuerSecret, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { ownerId?: unknown; label?: unknown; scopes?: unknown };
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    // Rejected, not filtered: silently dropping an unknown scope would hand back
    // a key that fails later, far from the request that asked for it.
    const scopes = parseScopes(body.scopes);
    if (!scopes) {
      res.status(400).json({ error: 'scopes must be a list of known scopes.' });
      return;
    }
    const label = typeof body.label === 'string' ? body.label.slice(0, 200) : undefined;
    // CI policy keys are the Team line. Keys already issued keep working; this
    // only stops new ones. Fails open on a lookup error, like `quota`.
    if (scopes.includes('policy:write')) {
      const ent = await resolveEntitlement(ownerId).catch(() => null);
      if (ent && !ent.plan.ciPolicyKeys) {
        res.status(403).json({
          error: `Keys that change policy from CI come with the Team plan. You are on ${ent.plan.name}.`,
        });
        return;
      }
    }
    try {
      const { key, row } = await createKey(db, { ownerId, label, tier: 'free', scopes });
      capture(ownerId, 'api_key_created', { tier: row.tier });
      res.status(201).json({ key, prefix: row.prefix, scopes: row.scopes });
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
    const limit =
      limitRaw && Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined;
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
      const { total, packages: rows } = await getContributionsByOwner(db, ownerId, {
        limit,
        offset,
      });
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
          /** null = scanned before the check existed, so it was never run. Kept
           *  distinct from 0 so the dashboard cannot render "not checked" as a
           *  clean stack. */
          conflicts: row.drift.conflictsAtLatest?.length ?? null,
          transitive: row.drift.transitive
            ? {
                resolved: row.drift.transitive.resolved,
                tracked: row.drift.transitive.tracked,
                advisoryPackages: row.drift.transitive.advisoryPackages,
                deprecated: row.drift.transitive.deprecated,
                truncated: row.drift.transitive.truncated,
                attributed: row.drift.transitive.attributed,
              }
            : null,
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

  /**
   * Register everything an installation currently covers, then scan in the
   * background. Returns the number of repos registered.
   *
   * Shared by the post-install redirect and the webhook so both agree on what
   * "connected" means, and so neither takes a repo's shape from a payload — the
   * inventory is always re-read from the API, which is the only source carrying
   * `default_branch` (a webhook's repo object does not, and defaulting it to
   * `main` would silently scan the wrong branch).
   *
   * `scanOnly` limits the background scan without limiting the registration: a
   * webhook that adds one repo to a 200-repo installation should register the
   * inventory it just read but not re-scan 199 repos nobody touched.
   */
  const syncInstallation = async (
    ownerId: string,
    installationId: number,
    scanOnly?: string[],
  ): Promise<number> => {
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
    // Deliberately not awaited: a first scan of a large account is minutes of
    // GitHub calls, and holding the request open for it would time out at the
    // edge and look like a failed install. Most-recently-pushed first, because
    // the scan is sequential and that order is what the user watching the
    // dashboard experiences as speed (see byRecentPush).
    void (async () => {
      const rows = byRecentPush(await listRepos(db, ownerId), found);
      const only = scanOnly ? new Set(scanOnly) : null;
      await scanRepos(db, only ? rows.filter((row) => only.has(row.fullName)) : rows);
    })().catch((err: unknown) => {
      logger.warn(`repo scan failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    return connected;
  };

  app.post(
    '/repos/connect',
    requireIssuerSecret,
    requireGithubApp,
    async (req: Request, res: Response) => {
      const ownerId = ownerFrom(req);
      const installationRaw = (req.body ?? {}).installationId;
      const installationId = Number(installationRaw);
      if (!ownerId || !Number.isInteger(installationId) || installationId <= 0) {
        res.status(400).json({ error: 'ownerId and installationId are required.' });
        return;
      }
      try {
        res.status(200).json({ connected: await syncInstallation(ownerId, installationId) });
      } catch (err) {
        const status = err instanceof GithubAppError ? err.status : 502;
        logger.error('repo connect failed:', err instanceof Error ? err.message : String(err));
        res.status(status).json({ error: 'Could not read the GitHub installation.' });
      }
    },
  );

  /**
   * GitHub App webhook — the only route here authenticated by GitHub's signature
   * rather than by the issuer secret or an API key.
   *
   * Not behind `requireIssuerSecret` (GitHub cannot present it) and not behind the
   * per-IP limiter (GitHub's delivery IPs are shared, and 429-ing them drops
   * events silently). The HMAC over the raw body is the gate, and an unset secret
   * 404s the route rather than leaving it open.
   *
   * Acks before doing the work: GitHub retries on timeout, and a duplicate
   * delivery would re-run the sync — idempotent, but a wasted scan of the whole
   * installation each time.
   */
  app.post('/github/webhook', requireGithubApp, async (req: Request, res: Response) => {
    const secret = config.LURQ_GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      res.status(404).end();
      return;
    }
    const raw = (req as RawBodyRequest).rawBody;
    const signature = req.headers['x-hub-signature-256'];
    if (
      !raw ||
      !verifyWebhookSignature(secret, raw, typeof signature === 'string' ? signature : undefined)
    ) {
      res.status(401).json({ error: 'Invalid signature.' });
      return;
    }

    const event = req.headers['x-github-event'];
    const action = parseWebhook(typeof event === 'string' ? event : undefined, req.body);
    res.status(202).end();
    if (action.kind === 'ignored') return;

    try {
      if (action.kind === 'uninstalled') {
        const forgotten = await deleteReposByInstallation(db, action.installationId);
        logger.info(`installation ${action.installationId} uninstalled, forgot ${forgotten} repos`);
        return;
      }

      // Removals first, and they need no owner lookup — the rows carry it. Doing
      // them before the owner check also means a user who removes their *last*
      // repo still gets it deleted, even though that erases the very mapping the
      // addition path depends on (see ownerForInstallation).
      if (action.removed.length > 0) {
        await deleteReposByInstallation(db, action.installationId, action.removed);
      }
      if (action.added.length === 0) return;

      const ownerId = await ownerForInstallation(db, action.installationId);
      if (!ownerId) {
        // An installation nobody has connected through the dashboard: there is no
        // lurq user to attribute these repos to, and guessing one would hand
        // someone else's repos to an account. Dropping it is correct.
        logger.warn(`webhook for unlinked installation ${action.installationId}, ignored`);
        return;
      }
      await syncInstallation(ownerId, action.installationId, action.added);
    } catch (err) {
      // The ack already went out; GitHub will not retry. Logged rather than
      // thrown, and the next nightly scan reconciles anything missed — but
      // alerted, because until then the repo is missing from someone's dashboard.
      logger.error(
        `webhook handling failed for installation ${action.installationId}:`,
        err instanceof Error ? err.message : String(err),
      );
      alert(
        'github-webhook',
        `${action.kind} for installation ${action.installationId} failed (${errorKind(err)})`,
      );
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

  // Must stay above `/repos/:id` — Express matches in registration order, and
  // `:id` would otherwise capture the literal "alerts" and 400 on Number('alerts').
  app.get(
    '/repos/alerts',
    requireIssuerSecret,
    requireGithubApp,
    async (req: Request, res: Response) => {
      const ownerId = ownerFrom(req);
      if (!ownerId) {
        res.status(400).json({ error: 'ownerId is required.' });
        return;
      }
      try {
        res.status(200).json({ alerts: await listAlerts(db, ownerId) });
      } catch (err) {
        logger.error('alert list failed:', err instanceof Error ? err.message : String(err));
        res.status(500).json({ error: 'Could not list alerts.' });
      }
    },
  );

  app.get(
    '/repos/:id',
    requireIssuerSecret,
    requireGithubApp,
    async (req: Request, res: Response) => {
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
          autoMerge: row.policy.autoMerge,
        });
        res.status(200).json({
          repo: {
            ...toDashboardRepo(row),
            deps: row.drift?.deps ?? [],
            transitiveRisks: row.drift?.transitive?.risks ?? [],
            conflicts: row.drift?.conflictsAtLatest ?? null,
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
    },
  );

  app.get(
    '/repos/:id/brief',
    requireIssuerSecret,
    requireGithubApp,
    async (req: Request, res: Response) => {
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
    },
  );

  app.post(
    '/repos/:id/scan',
    requireIssuerSecret,
    requireGithubApp,
    async (req: Request, res: Response) => {
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
    },
  );

  app.patch(
    '/repos/:id',
    requireIssuerSecret,
    requireGithubApp,
    async (req: Request, res: Response) => {
      const ownerId = ownerFrom(req);
      const id = Number(req.params.id);
      const policy = parsePolicy((req.body ?? {}).policy);
      if (!ownerId || !Number.isInteger(id) || !policy) {
        res
          .status(400)
          .json({ error: 'ownerId, a numeric id, and a complete policy are required.' });
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
        logger.error(
          'repo policy update failed:',
          err instanceof Error ? err.message : String(err),
        );
        res.status(500).json({ error: 'Could not update policy.' });
      }
    },
  );

  app.delete(
    '/repos/:id',
    requireIssuerSecret,
    requireGithubApp,
    async (req: Request, res: Response) => {
      const ownerId = ownerFrom(req);
      const id = Number(req.params.id);
      if (!ownerId || !Number.isInteger(id)) {
        res.status(400).json({ error: 'ownerId and a numeric id are required.' });
        return;
      }
      try {
        const removed = await deleteRepo(db, ownerId, id);
        res
          .status(removed ? 200 : 404)
          .json(removed ? { removed: true } : { error: 'Repo not found.' });
      } catch (err) {
        logger.error('repo delete failed:', err instanceof Error ? err.message : String(err));
        res.status(500).json({ error: 'Could not disconnect repo.' });
      }
    },
  );

  // ── Selection policy (dashboard-authenticated) ─────────────────────────────
  //
  // Not behind `requireGithubApp`: selection policy governs what an agent may
  // install through MCP, which works with no repository connected at all.
  // Gating it on the GitHub App would make the rules unreachable for exactly the
  // users who have only wired up the MCP server.

  app.get('/selection-policy', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    try {
      res.status(200).json({ policy: await getSelectionPolicy(db, ownerId) });
    } catch (err) {
      logger.error(
        'selection policy read failed:',
        err instanceof Error ? err.message : String(err),
      );
      res.status(500).json({ error: 'Could not read policy.' });
    }
  });

  app.put('/selection-policy', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    const parsed = validateSelectionPolicy((req.body ?? {}).policy);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const previous = await setSelectionPolicy(db, ownerId, parsed.policy, 'dashboard');
      res.status(200).json({ policy: parsed.policy, previous });
    } catch (err) {
      logger.error(
        'selection policy write failed:',
        err instanceof Error ? err.message : String(err),
      );
      res.status(500).json({ error: 'Could not save policy.' });
    }
  });

  // The same policy, run backwards over the repos that already exist. Not gated
  // on the GitHub App: an owner with no connected repos gets an empty list, which
  // the dashboard renders as "connect a repo", not as a failure.
  app.get(
    '/selection-policy/conformance',
    requireIssuerSecret,
    async (req: Request, res: Response) => {
      const ownerId = ownerFrom(req);
      if (!ownerId) {
        res.status(400).json({ error: 'ownerId is required.' });
        return;
      }
      try {
        res.status(200).json(await repoConformance(db, ownerId));
      } catch (err) {
        logger.error('conformance read failed:', err instanceof Error ? err.message : String(err));
        res.status(500).json({ error: 'Could not read conformance.' });
      }
    },
  );

  // ── Ask's package tools (dashboard-authenticated) ─────────────────────────
  //
  // The dashboard holds no API key for its user, so it cannot reach /mcp. These
  // run the same tools for the signed-in owner the web app names, and count
  // against that owner's plan exactly like an agent's call would: Ask looking a
  // package up is a hosted call, not a free side door around the quota.

  app.get('/ask-tools', requireIssuerSecret, async (_req: Request, res: Response) => {
    try {
      res.status(200).json({ tools: await listDashboardTools(db) });
    } catch (err) {
      logger.error('ask tools list failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not list Ask tools.' });
    }
  });

  app.post('/ask-tools/call', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    const body = (req.body ?? {}) as { name?: unknown; arguments?: unknown };
    const name = typeof body.name === 'string' ? body.name : '';
    if (!ownerId || !DASHBOARD_TOOLS.has(name)) {
      res.status(400).json({ error: 'ownerId and an Ask tool name are required.' });
      return;
    }
    const args =
      body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
        ? (body.arguments as Record<string, unknown>)
        : {};
    try {
      const ent = await resolveEntitlement(ownerId);
      if (!isAllowed(ent)) {
        res.status(402).json({
          error: `Monthly limit reached for the ${ent.plan.name} plan (${ent.used}/${ent.limit} calls).`,
        });
        return;
      }
    } catch (err) {
      // Fails open, for the reason `quota` does: an entitlement hiccup must not
      // read as "out of allowance" to every account at once.
      logger.error(
        'ask tool quota lookup failed, serving anyway:',
        err instanceof Error ? err.message : String(err),
      );
    }
    try {
      res.status(200).json(await callDashboardTool(db, ownerId, name, args));
    } catch (err) {
      logger.error('ask tool call failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not run that lookup.' });
    }
  });

  // ── Selection policy as code (API-key authenticated) ───────────────────────
  //
  // The same rules the dashboard edits, for `lurq policy pull/push` — so a team
  // can keep policy in a reviewed file and apply it from CI. Owner comes from the
  // key, never the body. Reads are open to any account key; writes need the
  // `policy:write` scope, which `lurq setup` never requests: the key sitting in an
  // agent's MCP config must not be able to loosen the policy that agent obeys.
  // Not behind `quota`: governing the agent should never compete with using it.

  // History and the decision log, shared by the key routes below and the
  // dashboard routes beside them: same reads, two ways of proving the owner.
  const sendPolicyHistory = async (ownerId: string, res: Response): Promise<void> => {
    try {
      res.status(200).json({ changes: await listPolicyChanges(db, ownerId) });
    } catch (err) {
      logger.error('policy history read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read policy history.' });
    }
  };

  const sendPolicyDecisions = async (ownerId: string, rawDays: unknown, res: Response) => {
    const days = rawDays === undefined ? 30 : Number(rawDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      res.status(400).json({ error: 'days must be a whole number from 1 to 365.' });
      return;
    }
    // Clamped to the plan's window rather than refused, and the served window is
    // echoed back so the caller can tell a quiet week from a short plan.
    const ent = await resolveEntitlement(ownerId).catch(() => null);
    const maxDays = ent?.plan.decisionLogDays ?? 365;
    const served = Math.min(days, maxDays);
    try {
      res
        .status(200)
        .json({ days: served, maxDays, decisions: await summarizeDecisions(db, ownerId, served) });
    } catch (err) {
      logger.error('policy decisions read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read policy decisions.' });
    }
  };

  app.get('/selection-policy/history', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    await sendPolicyHistory(ownerId, res);
  });

  app.get('/selection-policy/decisions', requireIssuerSecret, async (req: Request, res: Response) => {
    const ownerId = ownerFrom(req);
    if (!ownerId) {
      res.status(400).json({ error: 'ownerId is required.' });
      return;
    }
    await sendPolicyDecisions(ownerId, req.query.days, res);
  });

  const keyOwner = (req: Request, res: Response): string | null => {
    const ownerId = (req as AuthedRequest).lurqKey?.ownerId ?? null;
    if (!ownerId) res.status(403).json({ error: 'This key has no account attached.' });
    return ownerId;
  };

  // Usage row a session-start hook leaves, which is how the server knows an account's agents run lurq's hooks.
  const SESSION_START_USAGE = 'session-start';

  // What the session-start hook prints: the same open urgent changes tool results carry.
  app.get('/alerts', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    const ownerId = keyOwner(req, res);
    if (!ownerId) return;
    try {
      res.status(200).json({ notice: await agentAlertNotice(db, ownerId, new Date(), config.LURQ_WEB_URL.replace(/\/$/, '')) });
      capture(ownerId, 'agent_session_start', { agent: agentClient(req.query.agent) });
      void recordUsage(db, ownerId, SESSION_START_USAGE);
    } catch (err) {
      logger.error('alerts read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read alerts.' });
    }
  });

  app.get('/policy', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    const ownerId = keyOwner(req, res);
    if (!ownerId) return;
    try {
      res.status(200).json({ policy: await getSelectionPolicy(db, ownerId) });
    } catch (err) {
      logger.error('policy read failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not read policy.' });
    }
  });

  app.put('/policy', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    const ownerId = keyOwner(req, res);
    if (!ownerId) return;
    if (!hasScope((req as AuthedRequest).lurqKey!, 'policy:write')) {
      res.status(403).json({
        error: 'This key cannot change policy. Create a key with the policy:write scope in the dashboard.',
      });
      return;
    }
    const parsed = validateSelectionPolicy((req.body ?? {}).policy);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      // `previous` is what lets `lurq policy push` print the change it made,
      // diffed against what was actually replaced rather than a stale pull.
      const actor = `key ${(req as AuthedRequest).lurqKey!.prefix}`;
      const previous = await setSelectionPolicy(db, ownerId, parsed.policy, actor);
      res.status(200).json({ policy: parsed.policy, previous });
    } catch (err) {
      logger.error('policy write failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: 'Could not save policy.' });
    }
  });

  app.get('/policy/history', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    const ownerId = keyOwner(req, res);
    if (ownerId) await sendPolicyHistory(ownerId, res);
  });

  app.get('/policy/decisions', ipLimiter, auth, keyLimiter, async (req: Request, res: Response) => {
    const ownerId = keyOwner(req, res);
    if (ownerId) await sendPolicyDecisions(ownerId, req.query.days, res);
  });

  // ── Live MCP scans: CLI upload (API key) and dashboard reads (issuer) ──────
  registerMcpScanRoutes(app, {
    db,
    ipLimiter,
    auth: auth as unknown as RequestHandler,
    keyLimiter,
    quota,
    bigJson: express.json({ limit: MCP_SCAN_BODY_LIMIT }),
    requireIssuerSecret,
    ownerFrom,
    keyOwner,
  });

  // ── Account email: preferences and unsubscribe (issuer) ────────────────────
  registerNotificationRoutes(app, { db, requireIssuerSecret, ownerFrom });
  registerChannelRoutes(app, {
    db,
    requireIssuerSecret,
    ownerFrom,
    secretsKey: secretKey(config.LURQ_SECRETS_KEY),
    webUrl: config.LURQ_WEB_URL.replace(/\/$/, ''),
    allowed: (ownerId) => channelsAllowed(db, ownerId),
    post: (url, m) => postJson(url, m.payload, m.headers),
  });

  registerBuilderScanRoutes(app, { db, requireIssuerSecret, ownerFrom });

  // ── Autopilot CI surface (API-key authenticated, same as /mcp) ─────────────
  //
  // These two are what the user's GitHub Actions workflow calls. They are keyed
  // on the API key, NOT the issuer secret: the workflow is the user's own
  // machine, so it holds a per-user key and never the web↔backend shared secret.
  //
  // Note there is no repo id in either path. The workflow sends the manifest it
  // already has on disk, so `upgrade-plan` works in any checkout — connecting a
  // repo to the dashboard adds visibility, it is not a precondition for the loop.

  app.post(
    '/upgrade-plan',
    ipLimiter,
    auth,
    keyLimiter,
    quota,
    async (req: Request, res: Response) => {
      const deps = parseDepsInput((req.body ?? {}).deps);
      if (Object.keys(deps).length === 0) {
        res.status(400).json({ error: 'deps is required: { "package": "range", … }' });
        return;
      }
      // Read up front rather than at the policy lookup below: computeDrift now
      // attributes any first-time ingest it triggers to this caller.
      const ownerId = (req as AuthedRequest).lurqKey?.ownerId ?? null;
      try {
        const drift = await computeDrift(db, [{ path: 'package.json', deps }], null, ownerId);
        const brief = await briefRepo(db, drift);

        // Policy enforcement, when the caller identifies a repo this owner has
        // connected. `repo` is optional by design: the endpoint has always worked
        // in any checkout, and connecting is what opts a repo into being governed.
        // An unconnected or unrecognised name yields a null policy and the
        // unfiltered behaviour this endpoint shipped with.
        const repoFullName = parseRepoFullName((req.body ?? {}).repo);
        const policy =
          ownerId && repoFullName ? await findPolicyByFullName(db, ownerId, repoFullName) : null;
        const scoped = applyScope(brief.upgrades, policy);

        res.status(200).json({
          ...brief,
          ...scoped,
          // Surfaced so CI can log what lurq had no opinion on. An upgrade we do
          // not know about must not look like an upgrade we cleared.
          untracked: Object.keys(deps).length - drift.depsTracked,
        });
        // Counted like any other tool call. Usage was recorded only inside the MCP
        // server, so a user whose whole relationship with lurq is the weekly
        // autopilot saw a dashboard reading zero calls — the one view meant to
        // show them they are getting value. Fire-and-forget, after the response.
        void recordUsage(db, ownerId, 'upgrade-plan');
      } catch (err) {
        logger.error('upgrade plan failed:', err instanceof Error ? err.message : String(err));
        res.status(500).json({ error: 'Could not build the upgrade plan.' });
      }
    },
  );

  app.post(
    '/upgrade-runs',
    ipLimiter,
    auth,
    keyLimiter,
    quota,
    async (req: Request, res: Response) => {
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
            repoIds.set(
              run.repoFullName,
              await findRepoIdByFullName(db, ownerId, run.repoFullName),
            );
          }
        }
        const recorded = await recordUpgradeRuns(
          db,
          runs.map((run) => ({ ...run, ownerId, repoId: repoIds.get(run.repoFullName) ?? null })),
        );
        res.status(200).json({ recorded, rejected });
        void recordUsage(db, ownerId, 'upgrade-runs');
      } catch (err) {
        logger.error(
          'upgrade run record failed:',
          err instanceof Error ? err.message : String(err),
        );
        res.status(500).json({ error: 'Could not record the upgrade runs.' });
      }
    },
  );

  // Open urgent changes ride on tool results (see agentNotice). Only tools/call
  // pays for the lookup, and a failed lookup never fails the call.
  // ponytail: two indexed queries per tool call; cache per owner for ~60s if MCP latency shows it.
  // An account whose agents have never started a session through lurq's hooks hears
  // that the user can turn them on, at most once a day.
  // ponytail: in memory, so each replica nudges once a day; a table if that gets noisy.
  let nudgeDay = '';
  const nudged = new Set<string>();
  const setupNotice = async (ownerId: string): Promise<string | null> => {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== nudgeDay) {
      nudgeDay = day;
      nudged.clear();
    }
    if (nudged.has(ownerId)) return null;
    nudged.add(ownerId);
    const tools = await getUsageByTool(db, ownerId, 30);
    if (tools.some((t) => t.tool === SESSION_START_USAGE)) return null;
    return (
      "lurq: this account's agents are not using lurq's automatic checks (installs verified before they run, alerts at session start). " +
      `Mention once to the user that \`npx ${PACKAGE_NAME} setup\` turns them on for Claude Code, Codex and Cursor.`
    );
  };

  const alertNotice = async (ownerId: string | null, body: unknown): Promise<string | null> => {
    if (!ownerId || (body as { method?: unknown } | null)?.method !== 'tools/call') return null;
    try {
      const notices = await Promise.all([
        agentAlertNotice(db, ownerId, new Date(), config.LURQ_WEB_URL.replace(/\/$/, '')),
        setupNotice(ownerId),
      ]);
      return notices.filter(Boolean).join('\n\n') || null;
    } catch (err) {
      logger.error('agent alert lookup failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const serveMcp = async (req: Request, res: Response) => {
    // Stateless: a fresh server+transport per request, sharing the one DB pool.
    // Thread the authenticated key's owner identity into the tools (§3.1). An
    // anonymous discovery request has no key, so no owner and no quota notice,
    // and it cannot reach a tool that would use either.
    const authed = req as AuthedRequest;
    const ownerId = authed.lurqKey?.ownerId ?? null;
    // Which agent this is (clientInfo.ts): the id setup wrote into its config,
    // and on the handshake, the client's own name, which covers hand-written
    // configs too. Keyless discovery has no owner, so capture sends nothing.
    const client = agentClient(req.headers['x-lurq-client']);
    const handshake = initializeInfo(req.body);
    if (handshake) {
      capture(ownerId, 'mcp_initialized', { client, clientName: handshake.name, clientVersion: handshake.version });
    }
    const notices = [quotaNotice(authed.entitlement), await alertNotice(ownerId, req.body)];
    const server = buildMcpServer(db, { ownerId, client, notice: notices.filter(Boolean).join('\n\n') || null });
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
  };

  // Discovery without a key, so registries and directories can list lurq's tools.
  // Checked before the IP limiter so a request that falls through to the
  // authenticated route below is counted by that route's limiter exactly once.
  // Discovery skips the key limiter and the monthly quota: there is no key to
  // meter, and describing the server costs nobody an allowance.
  app.post(
    '/mcp',
    (req: Request, _res: Response, next: NextFunction) =>
      isAnonymousDiscovery(req.headers.authorization, req.body) ? next() : next('route'),
    ipLimiter,
    serveMcp,
  );
  app.post('/mcp', ipLimiter, auth, keyLimiter, quota, serveMcp);

  // Stateless server: no session GET/DELETE handling.
  app.all('/mcp', (_req: Request, res: Response) => {
    res.status(405).json(rpcError(-32000, 'Method not allowed.'));
  });

  // Terminal error handler. Registered last so it catches everything upstream,
  // including the two `express.json()` rejections that never reach a route:
  // a malformed body (400) and one over the 1mb limit (413).
  //
  // Without it those fell through to Express's default handler, which answers
  // with an HTML error page. Every other rejection on this server is JSON, so a
  // client — including lurq's own parseRpcBody — got undefined where it expected
  // a message and reported a bare "failed with HTTP 400" with no reason. The
  // one case where the body is the whole diagnosis was the one case it was
  // unreadable.
  //
  // Four parameters, and `_next` must stay: Express identifies an error handler
  // by arity, and dropping it silently turns this back into normal middleware.
  app.use((err: RequestError, req: Request, res: Response, _next: NextFunction) => {
    const { status, body, clientFault } = errorEnvelope(err, req.path);
    // A client's malformed request is not a server incident; only log the rest.
    if (!clientFault) {
      logger.error(`unhandled request error (${req.method} ${req.path}):`, err.message);
    }
    if (res.headersSent) return;
    res.status(status).json(body);
  });

  const server = app.listen(port, () => {
    logger.info(`lurq HTTP MCP server listening on :${port}/mcp`);
  });
  // A port already in use emits 'error' on the server, which is an unhandled
  // 'error' event — a crash with a stack trace instead of a sentence.
  server.on('error', (err: Error) => {
    logger.error(`could not listen on :${port}: ${err.message}`);
    process.exit(1);
  });

  /**
   * Drain on SIGTERM, which is how every deploy ends.
   *
   * Railway sends SIGTERM and then SIGKILLs what is still alive. With no handler
   * the default is immediate death, so every request in flight at that moment
   * dies mid-response — on a redeploy that is a burst of failures for callers
   * doing nothing wrong, and the agent on the other end reads it as lurq being
   * unreliable rather than as us shipping.
   *
   * `server.close` stops accepting new connections and waits for the open ones,
   * then the pool closes. The timer is the backstop: a wedged connection must
   * not hold the process past the platform's own grace period, and it is
   * unref'd so it can never be the thing keeping us alive.
   */
  const FORCE_EXIT_MS = 10_000;
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return; // a second SIGTERM must not race the first
    shuttingDown = true;
    logger.info(`${signal} received, draining…`);
    const force = setTimeout(() => {
      logger.warn('drain timed out, exiting anyway');
      process.exit(0);
    }, FORCE_EXIT_MS);
    force.unref();
    server.close(() => {
      // Queued PostHog events go before the pool; flush never throws.
      void flushAnalytics().then(closeDb).then(
        () => process.exit(0),
        () => process.exit(0),
      );
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
