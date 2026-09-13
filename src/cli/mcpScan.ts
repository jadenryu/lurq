/**
 * `lurq mcp-scan` and `lurq mcp-stack`: connect to every MCP server this user
 * has configured and report what it really exposes.
 *
 * Runs entirely on the user's machine with their own configuration, which is
 * what lets it cover every kind of server — remote, PyPI, Docker, private — and
 * report the contract their agent actually receives. Nothing here needs a
 * database; credentials never leave the process.
 *
 * Output discipline: the report (or `--json`) goes to stdout, progress to
 * stderr, so `lurq mcp-scan --json > report.json` stays parseable while a human
 * still sees servers land.
 */
import { resolve } from 'node:path';
import { SEVERITY_RANK, type Severity } from '../audit/types';
import { isCrowded } from '../compat/mcpStack';
import {
  analyzeServer,
  analyzeStackScan,
  sortFindings,
  worst,
  type McpFinding,
  type ServerAnalysis,
  type SnapshotDiff,
  diffSnapshots,
  type DiffInput,
} from '../mcpScan/analyze';
import { readServerConfigs, type ServerSpec } from '../mcpScan/config';
import { DEFAULTS, scanServers, type ServerScan } from '../mcpScan/connect';
import { loadLocal, saveLocal } from '../mcpScan/localHistory';
import { scrub } from '../mcpScan/redact';
import { contentHash, type Snapshot } from '../mcpScan/snapshot';
import { VERSION } from '../core/constants';
import { resolveApiKey } from '../core/userConfig';
import { bold, dim, green, red, table, yellow } from './format';
import { RemoteError, uploadMcpScan, type McpScanUploadResult, type UploadedServer } from './remote';

export interface McpScanCliOpts {
  json?: boolean;
  projectOnly?: boolean;
  trustProject?: boolean;
  /** Comma-separated aliases. */
  only?: string;
  /** Seconds. */
  timeout?: string;
  concurrency?: string;
  failOn?: string;
  /** `--no-history` sets this false. */
  history?: boolean;
  /** `--no-upload` sets this false: keep the scan on this machine. */
  upload?: boolean;
  /** `--no-contribute` sets this false: never offer public corroboration. */
  contribute?: boolean;
}

const THRESHOLDS = ['critical', 'high', 'moderate', 'low', 'info', 'none'] as const;

function parseThreshold(v: string | undefined): Severity | null {
  const t = (v ?? 'none').toLowerCase();
  if (!(THRESHOLDS as readonly string[]).includes(t)) {
    throw new Error(`--fail-on must be one of ${THRESHOLDS.join(', ')}; got "${v}"`);
  }
  return t === 'none' ? null : (t as Severity);
}

function parsePositive(v: string | undefined, name: string, fallback: number, max: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number; got "${v}"`);
  return Math.min(n, max);
}

export interface ServerReport extends Omit<ServerScan, 'snapshot'> {
  snapshot: Snapshot | null;
  analysis: ServerAnalysis | null;
  /** Null on a first scan, with --no-history, or when nothing comparable was read. */
  sinceLastScan: (Omit<SnapshotDiff, 'contract'> & { at: string; contract: Pick<SnapshotDiff['contract'], 'breaking' | 'removedTools' | 'addedTools' | 'silentDrift' | 'annotationFlips'> }) | null;
}

export interface ScanReport {
  root: string;
  filesRead: string[];
  notes: string[];
  servers: ServerReport[];
  stack: ReturnType<typeof analyzeStackScan>['stack'];
  /** Cross-server findings: collisions and shadowing. */
  findings: McpFinding[];
  worst: Severity | null;
  /** Null when not uploaded: no key, --no-upload, or nothing uploadable. */
  account: AccountSync | null;
}

export interface AccountSync {
  recorded: number;
  changed: number;
  results: McpScanUploadResult['servers'];
  rejected: { alias: string | null; reason: string }[];
  /** Why the upload stopped, when it did. The local report is unaffected. */
  error: string | null;
}

/** Can we ask the user a question? Never in CI, never with --json. */
const canPrompt = (opts: McpScanCliOpts) =>
  !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI && !opts.json;

const commandLine = (s: ServerSpec) =>
  scrub([s.command ?? s.url ?? '', ...s.args].join(' '), s.secrets).slice(0, 200);

/**
 * Offer to launch repository-committed servers for this run.
 *
 * Listed with their full command lines, because "launch 2 servers?" is not a
 * question anyone can answer responsibly. Declined-in-Claude-Code servers are
 * never offered: the user already said no.
 */
async function confirmProjectServers(specs: ServerSpec[], opts: McpScanCliOpts): Promise<void> {
  const pending = specs.filter((s) => !s.trusted && s.scope === 'project' && !/declined/.test(s.trustReason));
  if (!pending.length || !canPrompt(opts)) return;
  console.error(yellow(`\n${pending.length} server(s) are committed to this repository and have not been approved:`));
  for (const s of pending) console.error(`  ${bold(s.alias)}  ${dim(commandLine(s))}`);
  const { confirm } = await import('@inquirer/prompts');
  const yes = await confirm({ message: 'Launch them for this scan?', default: false });
  if (!yes) return;
  for (const s of pending) {
    s.trusted = true;
    s.trustReason = 'approved for this run';
  }
}

/**
 * The part of `next` that can honestly be compared with `prev`.
 *
 * A list that failed to read this time is not a list that emptied: carrying the
 * previous one forward stops a flaky prompts endpoint from reporting every
 * prompt removed. A truncated tool list cannot be compared at all.
 */
function comparable(prev: Snapshot, next: Snapshot): DiffInput | null {
  if (next.issues.some((i) => i.list === 'tools' && i.kind === 'truncated')) return null;
  const failed = new Set(next.issues.filter((i) => i.kind === 'list_failed').map((i) => i.list));
  return {
    tools: next.tools,
    prompts: failed.has('prompts') ? prev.prompts : next.prompts,
    resourceTemplates: failed.has('resourceTemplates') ? prev.resourceTemplates : next.resourceTemplates,
    instructions: next.instructions,
  };
}

function withHistory(scan: ServerScan, analysis: ServerAnalysis | null, useHistory: boolean): ServerReport {
  const report: ServerReport = { ...scan, analysis, sinceLastScan: null };
  if (!useHistory || !scan.snapshot) return report;

  const prev = loadLocal(scan.serverKey, scan.configFingerprint);
  const next = scan.snapshot;
  if (prev) {
    const input = comparable(prev.snapshot, next);
    if (input) {
      const d = diffSnapshots(prev.snapshot, input, scan.alias);
      report.sinceLastScan = {
        ...d,
        at: prev.scannedAt,
        contract: {
          breaking: d.contract.breaking,
          removedTools: d.contract.removedTools,
          addedTools: d.contract.addedTools,
          silentDrift: d.contract.silentDrift,
          annotationFlips: d.contract.annotationFlips,
        },
      };
    }
  }
  // Only a complete read becomes the next baseline. A partial one would make
  // tomorrow's scan report today's failed list as a change.
  if (scan.status === 'ok') {
    saveLocal({
      version: 1,
      serverKey: scan.serverKey,
      configFingerprint: scan.configFingerprint,
      scannedAt: new Date().toISOString(),
      contentHash: contentHash(next),
      snapshot: next,
    });
  }
  return report;
}

/** Read configs, scan, analyse. Shared by both commands. */
export async function collectScan(dir: string | undefined, opts: McpScanCliOpts): Promise<ScanReport> {
  const root = resolve(dir ?? process.cwd());
  const cfg = readServerConfigs(root, { projectOnly: opts.projectOnly, trustProject: opts.trustProject });
  const notes = [...cfg.notes];

  let specs = cfg.servers;
  if (opts.only) {
    const wanted = new Set(opts.only.split(',').map((s) => s.trim()).filter(Boolean));
    specs = specs.filter((s) => wanted.has(s.alias));
    const missing = [...wanted].filter((w) => !specs.some((s) => s.alias === w));
    if (missing.length) notes.push(`no configured server named ${missing.join(', ')}`);
  }

  await confirmProjectServers(specs, opts);

  const timeoutMs = parsePositive(opts.timeout, '--timeout', DEFAULTS.connectTimeoutMs / 1000, 600) * 1000;
  const concurrency = Math.floor(parsePositive(opts.concurrency, '--concurrency', DEFAULTS.concurrency, 16));

  const ctl = new AbortController();
  const onSignal = () => {
    if (ctl.signal.aborted) process.exit(130);
    ctl.abort();
    console.error(yellow('\nstopping: closing the servers already running (Ctrl-C again to force)'));
  };
  process.on('SIGINT', onSignal);

  const progress = !opts.json && process.stderr.isTTY;
  let scans: ServerScan[];
  try {
    scans = await scanServers(specs, {
      concurrency,
      connectTimeoutMs: timeoutMs,
      serverBudgetMs: Math.max(DEFAULTS.serverBudgetMs, timeoutMs + 60_000),
      signal: ctl.signal,
      onResult: (s) => {
        if (!progress) return;
        const mark = s.status === 'ok' ? green('✓') : s.status === 'partial' ? yellow('~') : dim('·');
        const what = s.snapshot ? `${s.snapshot.tools.length} tools` : s.status;
        console.error(`${mark} ${s.alias} ${dim(`${what} (${(s.durationMs / 1000).toFixed(1)}s)`)}`);
      },
    });
  } finally {
    process.off('SIGINT', onSignal);
  }

  const servers = scans.map((s) => withHistory(s, s.snapshot ? analyzeServer(s.snapshot) : null, opts.history !== false));
  const stackScan = analyzeStackScan(
    // Servers the user chose not to run are not part of the namespace being
    // assembled; servers that failed are, and make the stack unknown.
    servers
      .filter((s) => s.status !== 'disabled' && s.status !== 'untrusted')
      .map((s) => ({ alias: s.alias, snapshot: s.snapshot })),
  );

  const severities: { severity: Severity }[] = [
    ...servers.flatMap((s) => s.analysis?.findings ?? []),
    ...stackScan.findings,
    ...servers.flatMap((s) => (s.sinceLastScan && !s.sinceLastScan.unchanged ? [s.sinceLastScan] : [])),
  ];

  return {
    root,
    filesRead: cfg.filesRead,
    notes,
    servers,
    stack: stackScan.stack,
    findings: stackScan.findings,
    worst: worst(severities),
    account: null,
  };
}

const sevColour = (s: Severity) => (s === 'critical' || s === 'high' ? red : s === 'moderate' ? yellow : dim);

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return iso;
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function does(a: ServerAnalysis | null): string {
  const caps = Object.entries(a?.stats.capabilities ?? {}).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0)).map(([c]) => c);
  if (!caps.length) return dim('—');
  return caps.length > 2 ? `${caps.slice(0, 2).join(', ')} +${caps.length - 2}` : caps.join(', ');
}

function statusCell(s: ServerReport): string {
  if (s.status === 'ok') return green('ok');
  if (s.status === 'partial') return yellow('partial');
  if (s.status === 'untrusted' || s.status === 'disabled') return dim(s.status);
  return red(s.status);
}

function render(report: ScanReport): void {
  console.log(bold(report.root));
  console.log(dim(`read ${report.filesRead.length} config file(s): ${report.filesRead.join(', ') || '—'}`));
  console.log('');

  console.log(
    table(
      ['Server', 'Via', 'Status', 'Tools', 'Writes', 'Destroys', 'Does'],
      report.servers.map((s) => [
        s.alias,
        s.transportUsed ?? s.transport,
        statusCell(s),
        s.analysis ? String(s.analysis.stats.tools) : '—',
        s.analysis ? String(s.analysis.stats.writes) : '—',
        s.analysis ? (s.analysis.stats.destroys ? red(String(s.analysis.stats.destroys)) : '0') : '—',
        does(s.analysis),
      ]),
    ),
  );

  // The account's history outranks this machine's: it includes scans from CI
  // and teammates, so its "last scan" is the real one.
  const accountSince = new Map(
    (report.account?.results ?? []).filter((r) => r.since).map((r) => [r.alias, r.since!]),
  );
  const changes = report.servers.flatMap((s) => {
    const acc = accountSince.get(s.alias);
    if (acc) return [{ alias: s.alias, severity: acc.severity as Severity, at: acc.at, summary: acc.summary }];
    const d = s.sinceLastScan;
    return d && !d.unchanged ? [{ alias: s.alias, severity: d.severity, at: d.at, summary: d.summary }] : [];
  });
  if (changes.length) {
    console.log(`\n${bold('Since the last scan')}`);
    for (const c of changes) {
      console.log(`  ${sevColour(c.severity)(c.severity.toUpperCase().padEnd(8))} ${bold(c.alias)} ${dim(ago(c.at))}  ${c.summary}`);
    }
  }

  const findings = sortFindings([
    ...report.servers.flatMap((s) => (s.analysis?.findings ?? []).map((f) => ({ ...f, server: s.alias }))),
    ...report.findings,
  ]).filter((f) => f.severity !== 'info');
  if (findings.length) {
    console.log(`\n${bold('Findings')}`);
    for (const f of findings.slice(0, 40)) {
      const where = [f.server, f.tool].filter(Boolean).join(' › ');
      console.log(`  ${sevColour(f.severity)(f.severity.toUpperCase().padEnd(8))} ${bold(where || f.where)}  ${f.detail}`);
      if (f.evidence) console.log(`           ${dim(f.evidence)}`);
    }
    if (findings.length > 40) console.log(dim(`  … ${findings.length - 40} more (use --json)`));
  }

  const unread = report.servers.filter((s) => !s.snapshot);
  if (unread.length) {
    console.log(`\n${bold('Not read')}`);
    for (const s of unread) {
      console.log(`  ${bold(s.alias)} ${statusCell(s)}${s.error ? `  ${s.error}` : ''}`);
      if (s.hint) console.log(`    ${dim(s.hint)}`);
    }
  }

  console.log('');
  console.log(dim(report.stack.note));
  if (isCrowded(report.stack)) {
    console.log(yellow(`~${report.stack.estimatedContextTokens!.toLocaleString()} tokens of tool schema ride in every request — worth trimming`));
  }
  for (const n of report.notes) console.log(dim(`· ${n}`));

  const acc = report.account;
  if (acc) {
    if (acc.recorded) {
      console.log(dim(`recorded ${acc.recorded} server(s) to your account${acc.changed ? `, ${acc.changed} changed since the last upload` : ''}`));
    }
    for (const r of acc.rejected) console.log(yellow(`not recorded: ${r.alias ?? 'a server'}: ${r.reason}`));
    if (acc.error) console.log(yellow(`could not record this scan to your account: ${acc.error}`));
  } else if (!resolveApiKey()) {
    console.log(dim('run `lurq setup` to keep this history across machines and see it in the dashboard'));
  }
}

/** JSON for machines: full snapshots are omitted unless asked, they are large. */
function toJson(report: ScanReport) {
  return {
    ...report,
    servers: report.servers.map(({ snapshot, ...rest }) => ({
      ...rest,
      serverInfo: snapshot?.serverInfo ?? null,
      tools: snapshot?.tools.map((t) => t.name) ?? null,
      issues: snapshot?.issues ?? [],
    })),
  };
}

/** Servers never contacted are not history; there is nothing to record. */
const NOT_UPLOADED = new Set(['untrusted', 'disabled', 'cancelled']);

function toUpload(s: ServerReport): UploadedServer {
  return {
    alias: s.alias,
    serverKey: s.serverKey,
    configFingerprint: s.configFingerprint,
    registry: s.registry,
    packageName: s.packageName,
    pinnedVersion: s.pinnedVersion,
    transport: s.transport,
    status: s.status,
    error: s.error,
    snapshot: s.snapshot
      ? {
          serverInfo: s.snapshot.serverInfo,
          instructions: s.snapshot.instructions,
          tools: s.snapshot.tools,
          prompts: s.snapshot.prompts,
          resourceTemplates: s.snapshot.resourceTemplates,
        }
      : null,
  };
}

/**
 * Split uploads under the server's body ceiling and per-request server cap.
 *
 * Greedy and order-preserving. A server bigger than the budget on its own goes
 * alone rather than being dropped: the server decides whether it is too large,
 * and says so per server.
 */
export function chunkUploads<T>(items: T[], maxBytes = 3_000_000, maxCount = 50): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = JSON.stringify(item).length;
    if (current.length && (bytes + size > maxBytes || current.length >= maxCount)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Record the scan under the configured key's account.
 *
 * Never fails the scan: the local report is complete without it, and an
 * exhausted quota or an unreachable service should read as "not recorded",
 * not as a broken scanner.
 */
export async function syncToAccount(report: ScanReport, opts: McpScanCliOpts): Promise<AccountSync | null> {
  if (opts.upload === false || !resolveApiKey()) return null;
  const servers = report.servers.filter((s) => !NOT_UPLOADED.has(s.status)).map(toUpload);
  if (!servers.length) return null;

  const out: AccountSync = { recorded: 0, changed: 0, results: [], rejected: [], error: null };
  for (const chunk of chunkUploads(servers)) {
    try {
      const r = await uploadMcpScan({
        source: process.env.CI ? 'ci' : 'cli',
        clientVersion: VERSION,
        contribute: opts.contribute !== false,
        servers: chunk,
      });
      out.results.push(...r.servers);
      out.rejected.push(...r.rejected.map((x) => ({ alias: x.alias, reason: x.reason })));
    } catch (err) {
      out.error = err instanceof RemoteError ? err.message : err instanceof Error ? err.message : String(err);
      break;
    }
  }
  out.recorded = out.results.length;
  out.changed = out.results.filter((r) => r.change === 'changed').length;
  return out;
}

export async function runMcpScan(dir: string | undefined, opts: McpScanCliOpts): Promise<void> {
  const threshold = parseThreshold(opts.failOn);
  const report = await collectScan(dir, opts);
  report.account = await syncToAccount(report, opts);
  if (report.account) {
    report.worst = worst([
      ...(report.worst ? [{ severity: report.worst }] : []),
      ...report.account.results.flatMap((r) => (r.since ? [{ severity: r.since.severity as Severity }] : [])),
    ]);
  }

  if (opts.json) console.log(JSON.stringify(toJson(report), null, 2));
  else if (report.servers.length === 0) {
    console.log(dim(`no MCP servers configured for ${report.root}`));
    for (const n of report.notes) console.log(dim(`· ${n}`));
  } else render(report);

  if (threshold && report.worst && SEVERITY_RANK[report.worst] <= SEVERITY_RANK[threshold]) {
    process.exitCode = 1;
  }
}

/**
 * `lurq mcp-stack`: the namespace question alone, answered live.
 *
 * It used to read probed surfaces from a database, which a user with only an
 * API key does not have, and could only ever see npm servers.
 */
export async function runMcpStackLive(dir: string | undefined, opts: McpScanCliOpts): Promise<void> {
  const report = await collectScan(dir, { ...opts, history: false });
  if (opts.json) {
    console.log(JSON.stringify({ ...report.stack, findings: report.findings }, null, 2));
    return;
  }
  if (report.servers.length === 0) {
    console.log(dim(`no MCP servers configured for ${report.root}`));
    return;
  }
  const colour = report.stack.overall === 'conflict' ? red : report.stack.overall === 'unknown' ? yellow : green;
  console.log(`${bold(report.root)}  ${colour(report.stack.overall)}`);
  for (const c of report.stack.collisions) {
    const tag = c.writes ? red('writes') : yellow('read-only');
    console.log(`${red('✗')} ${bold(c.tool)} exposed by ${c.servers.join(' and ')}  [${tag}]`);
  }
  for (const f of report.findings.filter((x) => x.kind === 'cross_server_reference')) {
    console.log(`${sevColour(f.severity)('!')} ${bold(`${f.server} › ${f.tool}`)} ${f.detail}`);
  }
  console.log(
    table(
      ['Server', 'Status', 'Tools', 'Writes', 'Destroys'],
      report.servers.map((s) => [
        s.alias,
        statusCell(s),
        s.analysis ? String(s.analysis.stats.tools) : '—',
        s.analysis ? String(s.analysis.stats.writes) : '—',
        s.analysis ? (s.analysis.stats.destroys ? red(String(s.analysis.stats.destroys)) : '0') : '—',
      ]),
    ),
  );
  console.log(dim(report.stack.note));
  if (isCrowded(report.stack)) {
    console.log(yellow(`~${report.stack.estimatedContextTokens!.toLocaleString()} tokens of tool schema ride in every request — worth trimming`));
  }
}

export interface McpCiOpts {
  print?: boolean;
  force?: boolean;
  cron?: string;
  failOn?: string;
}

/**
 * `lurq mcp-ci`: write the daily scan workflow for this repository.
 *
 * Reads the committed configs with an EMPTY environment on purpose: every
 * `${VAR}` a server needs then shows up unresolved, which is exactly the list of
 * repository secrets the workflow has to map.
 */
export async function runMcpCi(dir: string | undefined, opts: McpCiOpts): Promise<void> {
  const threshold = parseThreshold(opts.failOn ?? 'high');
  const root = resolve(dir ?? process.cwd());
  const cfg = readServerConfigs(root, { projectOnly: true, trustProject: true, env: {} });

  const { MCP_SCAN_WORKFLOW_PATH, renderMcpScanWorkflow, secretNameFor } = await import('../github/mcpScanWorkflow');
  const secrets = [...new Set(cfg.servers.flatMap((s) => s.unresolved.filter((v) => !v.startsWith('input:'))))];
  const needsUv = cfg.servers.some((s) => s.registry === 'pypi' || /^(uvx|uv|pipx)$/.test((s.command ?? '').split(/[\\/]/).pop() ?? ''));
  const yaml = renderMcpScanWorkflow({ cron: opts.cron, failOn: threshold ?? 'none', secrets, needsUv });

  if (opts.print) {
    process.stdout.write(yaml);
    return;
  }

  const { existsSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const target = join(root, MCP_SCAN_WORKFLOW_PATH);
  if (existsSync(target) && !opts.force) {
    throw new Error(`${MCP_SCAN_WORKFLOW_PATH} already exists; pass --force to replace it`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, yaml);

  console.log(`wrote ${MCP_SCAN_WORKFLOW_PATH}`);
  if (cfg.servers.length === 0) {
    console.log(yellow('no MCP servers are committed to this repository yet; the workflow scans only committed configs (.mcp.json)'));
  } else {
    console.log(dim(`scans ${cfg.servers.length} committed server(s): ${cfg.servers.map((s) => s.alias).join(', ')}`));
  }
  console.log('add these repository secrets:');
  console.log(`  ${bold('LURQ_API_KEY')}  ${dim('your lurq key, so scans are recorded to your account')}`);
  for (const s of secrets.sort()) console.log(`  ${bold(secretNameFor(s))}${secretNameFor(s) !== s ? dim(`  (read by the server as ${s})`) : ''}`);
}
