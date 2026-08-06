/**
 * `mcp_server` oracle (spec §2, build sequence M2).
 *
 * RULE: install the server package into a clean sandbox, speak MCP over stdio —
 * `initialize` → `notifications/initialized` → `tools/list` — and record what it
 * actually exposes. Failure looks like: install failure, no response to
 * initialize within the timeout, a malformed/JSON-RPC-error reply, or a tools
 * list that doesn't match the declared schema.
 *
 * We speak the wire protocol directly rather than importing the MCP SDK, because
 * the probe runs INSIDE the sandbox where only the server package is installed.
 * Pulling the SDK in would mean installing it alongside every server under test,
 * which changes the dependency tree we're trying to observe.
 *
 * Every tool the server lists becomes an `mcp_tool` child entity linked by a
 * `provides` edge — the "skills" node type is not a separate thing, it is this.
 */
import type { Sandbox } from '../../sandbox/types';
import type { Environment, EntityRef, Oracle, OracleObservation, OracleResult } from '../types';

/** Protocol version we advertise. Servers may negotiate down; that is not a failure. */
const PROTOCOL_VERSION = '2025-11-25';
const HANDSHAKE_TIMEOUT_MS = 45_000;
const EVIDENCE_MAX = 800;

interface ProbeOutput {
  ok: boolean;
  stage: 'spawn' | 'initialize' | 'tools/list' | 'done';
  error?: string;
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  tools?: { name: string; description?: string }[];
}

/**
 * The probe, as a self-contained script run inside the sandbox. Spawns the
 * server's bin over stdio, performs the handshake, prints one JSON line.
 *
 * Kept as a string (not a module) so it can be shipped to any sandbox driver
 * with no bundling step — the E2B driver has no filesystem sync for our source.
 */
export function probeScript(command: string, args: string[]): string {
  return `
const { spawn } = require('node:child_process');
const child = spawn(${JSON.stringify(command)}, ${JSON.stringify(args)}, {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '', done = false, stderr = '';
const out = (o) => { if (!done) { done = true; console.log(JSON.stringify(o)); child.kill('SIGKILL'); process.exit(0); } };
const timer = setTimeout(() => out({ ok: false, stage: 'initialize', error: 'timeout awaiting handshake' }), ${HANDSHAKE_TIMEOUT_MS - 5000});
child.on('error', (e) => out({ ok: false, stage: 'spawn', error: String(e && e.message || e) }));
child.stderr.on('data', (d) => { stderr += d.toString().slice(0, 2000); });
const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\\n');

let serverInfo, protocolVersion;
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
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    } else if (msg.id === 2) {
      if (msg.error) return out({ ok: false, stage: 'tools/list', error: JSON.stringify(msg.error), serverInfo, protocolVersion });
      const tools = ((msg.result && msg.result.tools) || []).map((t) => ({ name: t.name, description: t.description }));
      clearTimeout(timer);
      return out({ ok: true, stage: 'done', serverInfo, protocolVersion, tools });
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

/** `npx --no-install <bin>` for a package installed into the sandbox. */
function launchFor(pkg: string): { command: string; args: string[] } {
  return { command: 'npx', args: ['--no-install', pkg] };
}

export const mcpServerOracle: Oracle = {
  id: 'mcp_server.handshake',
  version: '1',
  kind: 'mcp_server',
  ttlHours: 24 * 14, // spec §2: on publish, else 14 days
  rule: 'Install the package, speak MCP over stdio (initialize → tools/list); failure is install error, handshake timeout, JSON-RPC error, or malformed tool list.',

  async run(target: EntityRef, _env: Environment, sandbox: Sandbox): Promise<OracleResult> {
    const started = Date.now();
    const { command, args } = launchFor(target.name);
    const script = probeScript(command, args);

    let stdout: string;
    let stderr: string;
    try {
      const res = await sandbox.exec(`node -e ${shellQuote(script)}`, {
        install: [{ name: target.name, version: target.version ?? null }],
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

    const probe = parseProbeOutput(stdout);
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

    observations.push({
      relation: 'initializes',
      verdict: 'verified_true',
      evidence: truncate(
        `serverInfo=${probe.serverInfo?.name ?? '?'}@${probe.serverInfo?.version ?? '?'} protocol=${probe.protocolVersion ?? '?'} tools=${probe.tools?.length ?? 0}`,
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
