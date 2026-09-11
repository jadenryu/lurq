/**
 * `mcp_server` oracle (spec §2, build sequence M2).
 *
 * RULE: install the server package into a clean sandbox, speak MCP over stdio —
 * `initialize` → `notifications/initialized` → `tools/list` (drained across every
 * page) — and record what it actually exposes. Failure looks like: install
 * failure, no response to initialize within the timeout, a malformed/JSON-RPC-
 * error reply, or a tools list that doesn't match the declared schema.
 *
 * We speak the wire protocol directly rather than importing the MCP SDK, because
 * the probe runs INSIDE the sandbox where only the server package is installed.
 * Pulling the SDK in would mean installing it alongside every server under test,
 * which changes the dependency tree we're trying to observe.
 *
 * Every tool the server lists becomes an `mcp_tool` child entity linked by a
 * `provides` edge — the "skills" node type is not a separate thing, it is this.
 *
 * The probe returns each tool WHOLE — `inputSchema`, `outputSchema` and
 * `annotations`, not just name and description. Those three fields are the
 * contract an agent builds calls against; dropping them leaves the graph knowing
 * that a tool exists but not what calling it requires, which is the half that
 * actually breaks.
 */
import type { Sandbox } from '../../sandbox/types';
import type { McpTool } from '../../surface/mcp';
import type { Environment, EntityRef, Oracle, OracleObservation, OracleResult } from '../types';

/** Protocol version we advertise. Servers may negotiate down; that is not a failure. */
const PROTOCOL_VERSION = '2025-11-25';
const HANDSHAKE_TIMEOUT_MS = 45_000;
const EVIDENCE_MAX = 800;

/**
 * Pagination ceiling. `tools/list` is a paginated result and a server is free to
 * hand back cursors indefinitely; a runaway feed must terminate rather than hang
 * the sandbox. Hitting it sets `truncated`, which the caller MUST treat as a
 * measurement failure — a partially-drained list is indistinguishable from a
 * server that deleted the tools on the pages we never asked for.
 */
const MAX_PAGES = 50;

export interface ProbeOutput {
  ok: boolean;
  stage: 'spawn' | 'initialize' | 'tools/list' | 'done';
  error?: string;
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  tools?: McpTool[];
  /** How many `tools/list` pages were drained. */
  pages?: number;
  /** A cursor was still outstanding at MAX_PAGES: the list is INCOMPLETE. */
  truncated?: boolean;
}

/**
 * The probe, as a self-contained script run inside the sandbox. Resolves the
 * server's bin, spawns it over stdio, performs the handshake, drains every page
 * of `tools/list`, prints one JSON line.
 *
 * Kept as a string (not a module) so it can be shipped to any sandbox driver
 * with no bundling step — the E2B driver has no filesystem sync for our source.
 */
export function probeScript(pkg: string): string {
  return `
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join, basename } = require('node:path');

const PKG = ${JSON.stringify(pkg)};

/**
 * Resolve the server's entry point from its installed manifest.
 *
 * The package name is NOT the bin name often enough to matter —
 * @modelcontextprotocol/server-filesystem ships 'mcp-server-filesystem' — so
 * 'npx <pkg>' misses, and the miss looks exactly like a server that fails to
 * start. Read node_modules directly rather than require.resolve: an "exports"
 * map is allowed to hide ./package.json, and a fresh install always has the
 * flat path.
 */
function launch() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(process.cwd(), 'node_modules', PKG, 'package.json'), 'utf8'));
  } catch {
    return { command: 'npx', args: ['--no-install', PKG] };
  }
  let rel = null;
  if (typeof manifest.bin === 'string') rel = manifest.bin;
  else if (manifest.bin && typeof manifest.bin === 'object') {
    const keys = Object.keys(manifest.bin);
    rel = manifest.bin[basename(PKG)] || manifest.bin[keys[0]];
  }
  if (!rel) rel = manifest.main;
  if (!rel) return { command: 'npx', args: ['--no-install', PKG] };
  return { command: process.execPath, args: [join(process.cwd(), 'node_modules', PKG, rel)] };
}

const { command, args } = launch();
const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '', done = false, stderr = '';
/**
 * Emit the single result line and stop.
 *
 * The write callback is load-bearing. process.exit() abandons whatever has not
 * yet drained from a pipe-backed stdout, and Node's pipe writes are async — so
 * exiting on the next line silently truncates the payload at the pipe buffer
 * (8 KiB on Linux and macOS). A 13-tool server fits and a 9-tool server with
 * large nested schemas does not, which turned "this server documents its inputs
 * thoroughly" into "this server is unreachable": the truncated JSON fails to
 * parse and the caller records verified_false about a server that answered
 * perfectly. Exit only once the bytes are actually gone.
 */
const out = (o) => {
  if (done) return;
  done = true;
  try { child.kill('SIGKILL'); } catch {}
  process.stdout.write(JSON.stringify(o) + '\\n', () => process.exit(0));
};
const timer = setTimeout(() => out({ ok: false, stage: 'initialize', error: 'timeout awaiting handshake' }), ${HANDSHAKE_TIMEOUT_MS - 5000});
const send = (msg) => { try { child.stdin.write(JSON.stringify(msg) + '\\n'); } catch (e) { out({ ok: false, stage: 'spawn', error: 'stdin closed: ' + String(e && e.message || e) }); } };

let serverInfo, protocolVersion;
let tools = [], pages = 0, nextId = 2;

// Pull every page. A single unpaginated read is the difference between "this
// server exposes 12 tools" and "this server exposes the first 12 of 40" — and
// the second, diffed against a full read, reports 28 tools as removed.
const listTools = (cursor) => send({
  jsonrpc: '2.0', id: nextId, method: 'tools/list',
  params: cursor ? { cursor: cursor } : {},
});

child.on('error', (e) => out({ ok: false, stage: 'spawn', error: String(e && e.message || e) }));
child.stderr.on('data', (d) => { stderr += d.toString().slice(0, 2000); });

child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }  // servers log non-JSON to stdout
    if (msg.id === 1) {
      if (msg.error) return out({ ok: false, stage: 'initialize', error: JSON.stringify(msg.error) });
      serverInfo = msg.result && msg.result.serverInfo;
      protocolVersion = msg.result && msg.result.protocolVersion;
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      listTools(null);
    } else if (msg.id === nextId) {
      if (msg.error) return out({ ok: false, stage: 'tools/list', error: JSON.stringify(msg.error), serverInfo, protocolVersion });
      const result = msg.result || {};
      pages++;
      for (const t of result.tools || []) {
        tools.push({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          annotations: t.annotations,
        });
      }
      if (result.nextCursor && pages < ${MAX_PAGES}) { nextId++; listTools(result.nextCursor); return; }
      clearTimeout(timer);
      return out({
        ok: true, stage: 'done', serverInfo, protocolVersion, tools, pages,
        truncated: Boolean(result.nextCursor),
      });
    }
  }
});

child.on('exit', (code) => out({ ok: false, stage: 'spawn', error: 'exited ' + code + (stderr ? ': ' + stderr.slice(0, 400) : '') }));

send({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: ${JSON.stringify(PROTOCOL_VERSION)},
    capabilities: {},
    clientInfo: { name: 'lurq-oracle', version: '1' },
  },
});
`.trim();
}

/** Parse the probe's single JSON line out of whatever else landed on stdout. */
export function parseProbeOutput(stdout: string): ProbeOutput | null {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(t) as ProbeOutput;
      if (typeof parsed.ok === 'boolean') return parsed;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

/**
 * Install the server and probe it. Shared by the oracle (which turns the result
 * into observations) and the surface pipeline (which turns it into symbols), so
 * there is exactly one implementation of "what does this server expose".
 *
 * Throws ONLY on sandbox failure. A server that refuses to start resolves with
 * `ok: false` — that is evidence about the server, and the caller records it.
 */
export async function probeMcpServer(
  sandbox: Sandbox,
  pkg: string,
  version: string | null,
): Promise<{ probe: ProbeOutput | null; stderr: string }> {
  const script = probeScript(pkg);
  let stdout: string;
  let stderr: string;
  try {
    const res = await sandbox.exec(`node -e ${shellQuote(script)}`, {
      install: [{ name: pkg, version }],
      timeoutMs: HANDSHAKE_TIMEOUT_MS,
    });
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (err) {
    // The sandbox itself failed. This is NOT evidence about the server —
    // recording verified_false here would be a false negative, which the spec
    // rates as costlier than a hundred unknowns.
    throw new Error(`sandbox failure: ${String(err)}`);
  }
  return { probe: parseProbeOutput(stdout), stderr };
}

export const mcpServerOracle: Oracle = {
  id: 'mcp_server.handshake',
  version: '2', // v2: full tool schemas + paginated tools/list
  kind: 'mcp_server',
  ttlHours: 24 * 14, // spec §2: on publish, else 14 days
  rule: 'Install the package, speak MCP over stdio (initialize → tools/list, all pages); failure is install error, handshake timeout, JSON-RPC error, or malformed tool list.',

  async run(target: EntityRef, _env: Environment, sandbox: Sandbox): Promise<OracleResult> {
    const started = Date.now();
    const { probe, stderr } = await probeMcpServer(sandbox, target.name, target.version ?? null);

    const observations: OracleObservation[] = [];
    const discovered: EntityRef[] = [];

    if (!probe) {
      observations.push({
        relation: 'initializes',
        verdict: 'verified_false',
        evidence: truncate(`no probe output. stderr: ${stderr}`),
      });
      return { observations, costMillis: Date.now() - started };
    }

    if (!probe.ok) {
      observations.push({
        relation: 'initializes',
        verdict: 'verified_false',
        evidence: truncate(`stage=${probe.stage} ${probe.error ?? ''}`),
      });
      return { observations, costMillis: Date.now() - started };
    }

    // A truncated list is a measurement failure, not a finding. Recording it as
    // a successful read would let a later full read diff against it and report
    // every tool on the undrained pages as removed.
    if (probe.truncated) {
      observations.push({
        relation: 'initializes',
        verdict: 'unverifiable',
        evidence: truncate(
          `tools/list still paginating after ${MAX_PAGES} pages (${probe.tools?.length ?? 0} tools read); list is incomplete`,
        ),
      });
      return { observations, costMillis: Date.now() - started };
    }

    observations.push({
      relation: 'initializes',
      verdict: 'verified_true',
      evidence: truncate(
        `serverInfo=${probe.serverInfo?.name ?? '?'}@${probe.serverInfo?.version ?? '?'} protocol=${probe.protocolVersion ?? '?'} tools=${probe.tools?.length ?? 0} pages=${probe.pages ?? 1}`,
      ),
    });

    for (const tool of probe.tools ?? []) {
      const ref: EntityRef = {
        kind: 'mcp_tool',
        namespace: target.namespace,
        name: `${target.name}#${tool.name}`,
        version: target.version ?? null,
      };
      discovered.push(ref);
      observations.push({
        object: ref,
        relation: 'provides',
        verdict: 'verified_true',
        evidence: truncate(tool.description ?? tool.name),
      });
    }

    return { observations, discovered, costMillis: Date.now() - started };
  },
};

function truncate(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, EVIDENCE_MAX);
}

/** POSIX single-quote — the script contains quotes, newlines, and backslashes. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
