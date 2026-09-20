/**
 * Connect to a configured MCP server the way the user's agent does, and read
 * its whole contract.
 *
 * The premise of a live scan is fidelity: the user's own command line, env and
 * headers, so the answer is the contract their agent actually receives rather
 * than what a blank-config sandbox managed to coax out. Everything else here is
 * about running someone else's program safely and boundedly:
 *
 *   - every stage has a deadline, and a whole-server budget caps the sum, so a
 *     server that hangs costs seconds, not the scan
 *   - each list is isolated: prompts failing does not discard the tools
 *   - lists are read leniently (see `./snapshot`), paginated with a ceiling and
 *     a cursor-loop guard
 *   - the child process is always closed, and stderr is captured (bounded and
 *     scrubbed) instead of spraying over the user's terminal
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SseError } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport as SdkTransport } from '@modelcontextprotocol/sdk/shared/transport.js';
import * as z from 'zod/v4';
import { pMap } from '../core/concurrency';
import { VERSION } from '../core/constants';
import type { Registry, ServerSpec, Transport } from './config';
import { classifyError, type Classified, type ScanStatus } from './errors';
import { scrub, scrubDeep } from './redact';
import {
  addPrompts,
  addTemplates,
  addTools,
  emptySnapshot,
  LIMITS,
  type ListName,
  type PromptInfo,
  type ResourceTemplateInfo,
  type Snapshot,
} from './snapshot';
import type { McpTool } from '../surface/mcp';

export interface ScanOptions {
  /** Deadline for spawn + initialize. npx/uvx may download on first run. */
  connectTimeoutMs?: number;
  /** Deadline for each list page. */
  requestTimeoutMs?: number;
  /** Ceiling on everything for one server. */
  serverBudgetMs?: number;
  signal?: AbortSignal;
  /** Base environment for stdio servers. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface ServerScan {
  alias: string;
  serverKey: string;
  configFingerprint: string;
  registry: Registry;
  packageName: string | null;
  pinnedVersion: string | null;
  transport: Transport;
  /** What actually answered: `auto` resolves to http or sse. */
  transportUsed: 'stdio' | 'http' | 'sse' | null;
  status: ScanStatus;
  error: string | null;
  hint: string | null;
  /** Last lines of stderr, scrubbed. Diagnosis only; never analysed. */
  stderrTail: string | null;
  durationMs: number;
  /** Null unless the tool list was read. Already scrubbed. */
  snapshot: Snapshot | null;
}

export const DEFAULTS = {
  connectTimeoutMs: 60_000,
  requestTimeoutMs: 20_000,
  serverBudgetMs: 120_000,
  concurrency: 4,
} as const;

const STDERR_KEEP = 8_000;

/**
 * Environment for a stdio server: the user's own, as their agent would pass it,
 * minus lurq's credentials.
 *
 * Inheriting is deliberate. Agents launch servers with the full environment,
 * and servers routinely read a token the user exported in their shell rather
 * than wrote into the config. Passing only the config's `env` would report
 * those as broken when they work. What is withheld is lurq's own key, which a
 * third-party server has no business seeing in CI.
 */
function childEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k.startsWith('LURQ_')) continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}

/** Lenient page shapes: entries are validated one by one in `./snapshot`. */
const Page = (key: string) =>
  z.looseObject({ [key]: z.array(z.unknown()).optional(), nextCursor: z.string().optional() });

class Deadline extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not finish within ${Math.round(ms / 1000)}s`);
    this.name = 'Deadline';
  }
}

function before<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Deadline(what, ms)), ms);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

interface Conn {
  client: Client;
  transport: SdkTransport;
  kind: 'stdio' | 'http' | 'sse';
  stderr: () => string;
  noise: () => number;
}

function openStdio(spec: ServerSpec, opts: ScanOptions): Conn {
  const transport = new StdioClientTransport({
    command: spec.command!,
    args: spec.args,
    env: childEnv(opts.env ?? process.env, spec.env),
    cwd: spec.cwd ?? undefined,
    stderr: 'pipe',
  });
  let tail = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    tail = (tail + chunk.toString('utf8')).slice(-STDERR_KEEP);
  });
  return wrap(transport, 'stdio', () => tail);
}

function openHttp(spec: ServerSpec, kind: 'http' | 'sse'): Conn {
  const url = new URL(spec.url!);
  const requestInit = { headers: spec.headers };
  const transport =
    kind === 'http'
      ? new StreamableHTTPClientTransport(url, {
          requestInit,
          reconnectionOptions: {
            maxRetries: 0,
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1,
          },
        })
      : new SSEClientTransport(url, {
          requestInit,
          eventSourceInit: {
            fetch: (u, init) =>
              fetch(u, {
                ...init,
                headers: { ...(init?.headers as Record<string, string>), ...spec.headers },
              }),
          },
        });
  return wrap(transport, kind, () => '');
}

function wrap(transport: SdkTransport, kind: Conn['kind'], stderr: () => string): Conn {
  const client = new Client({ name: 'lurq-scan', version: VERSION }, { capabilities: {} });
  let noise = 0;
  client.onerror = (err) => {
    // Malformed stdout lines surface here and the stream carries on; counted
    // so a failure can say "your server logs to stdout" instead of "failed".
    if (err instanceof SyntaxError || (err as { name?: string }).name === 'ZodError') noise++;
  };
  return { client, transport, kind, stderr, noise: () => noise };
}

async function close(conn: Conn): Promise<void> {
  // Client.close closes the transport; for stdio that escalates stdin EOF →
  // SIGTERM → SIGKILL. Bounded, because a close that hangs is still a hang.
  await before(conn.client.close(), 6_000, 'close').catch(() => {});
  // ponytail: npx/uvx grandchildren are left to the runner's signal forwarding;
  // spawn detached and kill the process group if orphans show up in practice.
}

/** Page through one list, leniently, stopping at the ceiling or a cursor loop. */
async function paginate(
  conn: Conn,
  method: string,
  key: string,
  list: ListName,
  snapshot: Snapshot,
  opts: Required<Pick<ScanOptions, 'requestTimeoutMs'>> & { signal?: AbortSignal },
  onPage: (entries: unknown[]) => boolean,
  maxPages: number = LIMITS.pages,
): Promise<void> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      snapshot.issues.push({
        list,
        kind: 'truncated',
        detail: `still paginating after ${maxPages} pages`,
      });
      return;
    }
    const result = await conn.client.request(
      { method, params: cursor ? { cursor } : {} } as never,
      Page(key),
      { timeout: opts.requestTimeoutMs, signal: opts.signal },
    );
    const entries = (result as Record<string, unknown>)[key];
    if (!onPage(Array.isArray(entries) ? entries : [])) return;
    const next = (result as { nextCursor?: string }).nextCursor;
    if (!next) return;
    if (seen.has(next)) {
      // A server handing back a cursor it already gave would page forever.
      snapshot.issues.push({
        list,
        kind: 'truncated',
        detail: 'the server repeated a pagination cursor',
      });
      return;
    }
    seen.add(next);
    cursor = next;
  }
}

const isMethodNotFound = (err: unknown) => (err as { code?: number })?.code === -32601;

async function readContract(
  conn: Conn,
  opts: Required<Pick<ScanOptions, 'requestTimeoutMs'>> & { signal?: AbortSignal },
): Promise<Snapshot> {
  const snapshot = emptySnapshot();
  const caps = conn.client.getServerCapabilities() ?? {};
  const info = conn.client.getServerVersion();
  snapshot.serverInfo = {
    name: typeof info?.name === 'string' ? info.name.slice(0, LIMITS.name) : null,
    version: typeof info?.version === 'string' ? info.version.slice(0, 100) : null,
    title:
      typeof (info as { title?: unknown })?.title === 'string'
        ? (info as { title: string }).title.slice(0, LIMITS.name)
        : null,
  };
  snapshot.protocolVersion =
    (conn.transport as { protocolVersion?: string }).protocolVersion ?? null;
  snapshot.capabilities = {
    tools: !!caps.tools,
    prompts: !!caps.prompts,
    resources: !!caps.resources,
    logging: !!caps.logging,
    completions: !!caps.completions,
    toolsListChanged: !!(caps.tools as { listChanged?: boolean } | undefined)?.listChanged,
  };
  const instructions = conn.client.getInstructions();
  if (typeof instructions === 'string' && instructions) {
    snapshot.instructions = instructions.slice(0, LIMITS.instructions);
    if (instructions.length > LIMITS.instructions) {
      snapshot.issues.push({
        list: 'initialize',
        kind: 'oversized',
        detail: `instructions are ${instructions.length} chars`,
      });
    }
  }

  // Tools are the contract, so their failure is the server's failure. Asked
  // even when the capability is undeclared: servers forget to declare it far
  // more often than they lack tools, and "method not found" is a clean no.
  const tools = new Map<string, McpTool>();
  try {
    await paginate(conn, 'tools/list', 'tools', 'tools', snapshot, opts, (e) =>
      addTools(e, tools, snapshot.issues),
    );
  } catch (err) {
    if (!(isMethodNotFound(err) && !caps.tools)) throw err;
  }
  snapshot.tools = [...tools.values()];

  // Everything else is best-effort: a failure is recorded, never fatal.
  const secondary = async (list: ListName, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      if (isMethodNotFound(err)) return;
      snapshot.issues.push({
        list,
        kind: 'list_failed',
        detail: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    }
  };

  if (caps.prompts) {
    const prompts = new Map<string, PromptInfo>();
    await secondary('prompts', () =>
      paginate(conn, 'prompts/list', 'prompts', 'prompts', snapshot, opts, (e) =>
        addPrompts(e, prompts, snapshot.issues),
      ),
    );
    snapshot.prompts = [...prompts.values()];
  }
  if (caps.resources) {
    const templates = new Map<string, ResourceTemplateInfo>();
    await secondary('resourceTemplates', () =>
      paginate(
        conn,
        'resources/templates/list',
        'resourceTemplates',
        'resourceTemplates',
        snapshot,
        opts,
        (e) => addTemplates(e, templates, snapshot.issues),
      ),
    );
    snapshot.resourceTemplates = [...templates.values()];
    // Counted, never kept: a filesystem server lists the user's files here.
    let count = 0;
    await secondary('resources', () =>
      paginate(
        conn,
        'resources/list',
        'resources',
        'resources',
        snapshot,
        opts,
        (e) => {
          count += e.length;
          return true;
        },
        LIMITS.resourcePages,
      ),
    );
    snapshot.resourceCount = count;
  }

  if (conn.noise() > 0) {
    snapshot.issues.push({
      list: 'initialize',
      kind: 'stdout_noise',
      detail: `${conn.noise()} non-protocol line(s) on stdout; some clients will fail on this`,
    });
  }
  return snapshot;
}

/** Should a failed Streamable HTTP attempt fall back to legacy SSE? */
function shouldTrySse(err: unknown): boolean {
  if (err instanceof StreamableHTTPError)
    return [400, 404, 405].includes(err.code ?? 0) || err.code === -1;
  return false;
}

function result(
  spec: ServerSpec,
  started: number,
  fields: Partial<ServerScan> & Pick<ServerScan, 'status'>,
): ServerScan {
  return {
    alias: spec.alias,
    serverKey: spec.serverKey,
    configFingerprint: spec.configFingerprint,
    registry: spec.registry,
    packageName: spec.packageName,
    pinnedVersion: spec.pinnedVersion,
    transport: spec.transport,
    transportUsed: null,
    error: null,
    hint: null,
    stderrTail: null,
    snapshot: null,
    durationMs: Date.now() - started,
    ...fields,
  };
}

async function attempt(
  spec: ServerSpec,
  kind: 'stdio' | 'http' | 'sse',
  opts: ScanOptions,
  started: number,
): Promise<ServerScan | { retrySse: true }> {
  const connectTimeoutMs =
    opts.connectTimeoutMs ?? (kind === 'stdio' ? DEFAULTS.connectTimeoutMs : 20_000);
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
  const budget = opts.serverBudgetMs ?? DEFAULTS.serverBudgetMs;

  let conn: Conn | null = null;
  let stage: 'connect' | 'list' = 'connect';
  try {
    conn = kind === 'stdio' ? openStdio(spec, opts) : openHttp(spec, kind);
    const c = conn;
    const work = (async () => {
      await before(
        c.client.connect(c.transport, { timeout: connectTimeoutMs, signal: opts.signal }),
        connectTimeoutMs + 2_000,
        'connect',
      );
      stage = 'list';
      return readContract(c, { requestTimeoutMs, signal: opts.signal });
    })();
    const snapshot = await before(work, Math.max(1_000, budget - (Date.now() - started)), 'scan');

    const clean = scrubDeep(snapshot, spec.secrets);
    const partial = clean.issues.some((i) => i.kind === 'list_failed' || i.kind === 'truncated');
    return result(spec, started, {
      status: partial ? 'partial' : 'ok',
      transportUsed: kind,
      snapshot: clean,
      stderrTail: tailOf(conn, spec),
    });
  } catch (err) {
    if (kind === 'http' && spec.transport === 'auto' && shouldTrySse(err))
      return { retrySse: true };
    if (opts.signal?.aborted) {
      return result(spec, started, {
        status: 'cancelled',
        transportUsed: kind,
        error: 'scan interrupted',
      });
    }
    const c: Classified =
      err instanceof Deadline
        ? {
            status: 'timeout',
            error: err.message,
            hint:
              stage === 'connect' && kind === 'stdio'
                ? 'a first run of npx/uvx downloads the package; retry with a longer --timeout'
                : null,
          }
        : classifyError(err, {
            stage,
            transport: kind,
            command: spec.command,
            stderrTail: conn?.stderr() ?? '',
            stdoutNoise: conn?.noise() ?? 0,
          });
    return result(spec, started, {
      status: c.status,
      transportUsed: kind,
      error: scrub(c.error, spec.secrets),
      hint: c.hint,
      stderrTail: tailOf(conn, spec),
    });
  } finally {
    if (conn) await close(conn);
  }
}

function tailOf(conn: Conn | null, spec: ServerSpec): string | null {
  const t = conn?.stderr().trim();
  return t ? scrub(t.split('\n').slice(-20).join('\n'), spec.secrets).slice(-2_000) : null;
}

/** Scan one server. Never throws: every outcome is a `ServerScan`. */
export async function scanServer(spec: ServerSpec, opts: ScanOptions = {}): Promise<ServerScan> {
  const started = Date.now();
  if (spec.disabled)
    return result(spec, started, { status: 'disabled', hint: 'disabled in its config' });
  if (!spec.trusted) return result(spec, started, { status: 'untrusted', hint: spec.trustReason });
  if (spec.unresolved.length) {
    return result(spec, started, {
      status: 'needs_config',
      error: `no value for ${spec.unresolved.join(', ')}`,
      hint: `export ${spec.unresolved.filter((v) => !v.startsWith('input:')).join(', ') || 'the missing values'} before scanning`,
    });
  }
  if (opts.signal?.aborted)
    return result(spec, started, { status: 'cancelled', error: 'scan interrupted' });

  try {
    if (spec.transport === 'stdio') {
      if (!spec.command)
        return result(spec, started, { status: 'spawn_failed', error: 'no command configured' });
      return (await attempt(spec, 'stdio', opts, started)) as ServerScan;
    }
    if (!spec.url)
      return result(spec, started, { status: 'unreachable', error: 'no url configured' });
    try {
      new URL(spec.url);
    } catch {
      return result(spec, started, {
        status: 'unreachable',
        error: 'the configured url is not valid',
        hint: 'check the url in the config',
      });
    }
    const first = await attempt(spec, spec.transport === 'sse' ? 'sse' : 'http', opts, started);
    if ('retrySse' in first) return (await attempt(spec, 'sse', opts, started)) as ServerScan;
    return first;
  } catch (err) {
    // attempt() classifies everything it can; this is a bug guard, not a path.
    return result(spec, started, {
      status: 'protocol_error',
      error: scrub(err instanceof Error ? err.message : String(err), spec.secrets),
    });
  }
}

/** Scan many servers with bounded concurrency, reporting each as it lands. */
export async function scanServers(
  specs: ServerSpec[],
  opts: ScanOptions & { concurrency?: number; onResult?: (scan: ServerScan) => void } = {},
): Promise<ServerScan[]> {
  return pMap(
    specs,
    async (spec) => {
      const scan = await scanServer(spec, opts);
      opts.onResult?.(scan);
      return scan;
    },
    Math.max(1, opts.concurrency ?? DEFAULTS.concurrency),
  );
}

export { SseError };
