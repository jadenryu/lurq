/**
 * The pinned "lurq dashboard" issue: one issue per repository, edited in place
 * by the scheduled scan, the way Renovate's Dependency Dashboard works.
 *
 * Quiet by construction. Editing an issue body notifies nobody, so the daily
 * refresh is silent; lurq comments — which does notify watchers — only when a
 * scan finds something that needs a person today, and never twice for the same
 * thing. The body is only rewritten when its content actually changed.
 *
 * Everything in the body that came from outside lurq (server aliases, tool
 * names, change summaries, package names) is escaped: no links, no images, no
 * @-mentions and no #-references, so a poisoned tool description cannot ping a
 * maintainer or cross-link an unrelated issue.
 */
import { createHash } from 'node:crypto';
import type { Severity } from '../audit/types';
import type { ScanReport } from '../cli/mcpScan';
import type { RemotePlan } from '../cli/remote';

export const DASHBOARD_MARKER = '<!-- lurq:dashboard -->';
export const DASHBOARD_LABEL = 'lurq';
export const DASHBOARD_TITLE = 'lurq dashboard';
const MAX_ALERTED_KEYS = 200;
const MAX_ROWS = 25;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Markdown-safe inline text from an untrusted string. */
export function md(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  const clipped = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return clipped
    .replace(/[\\`*_[\]<>|~]/g, (c) => `\\${c}`)
    .replace(/@/g, '@​')
    .replace(/#(?=\d)/g, '#​')
    .replace(/:\/\//g, ':​//');
}

/** A code span for a name, with anything that could close the span removed. */
export const code = (s: string) => `\`${s.replace(/[`\r\n]/g, '').slice(0, 120)}\``;

export interface UrgentNote {
  key: string;
  line: string;
}

export interface RenderedIssue {
  title: string;
  /** Without the hash and alerted markers; the client adds those. */
  body: string;
  hash: string;
  urgent: UrgentNote[];
}

export interface IssueInput {
  repo: string;
  generatedAt: Date;
  runUrl: string | null;
  dashboardUrl: string;
  scan: ScanReport | null;
  plan: RemotePlan | null;
  /** Why the dependency section is missing, when it is. */
  planNote: string | null;
}

const RANK: Record<Severity, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

function mcpSection(scan: ScanReport, urgent: UrgentNote[]): string[] {
  const lines = ['### MCP servers', ''];
  if (!scan.servers.length) return [...lines, 'No MCP servers are committed to this repository.', ''];

  lines.push('| Server | Status | Tools | Can modify | Findings |', '| --- | --- | --- | --- | --- |');
  for (const s of scan.servers.slice(0, MAX_ROWS)) {
    const f = s.analysis?.findings.filter((x) => RANK[x.severity] <= RANK.moderate) ?? [];
    const worst = f.sort((a, b) => RANK[a.severity] - RANK[b.severity])[0]?.severity;
    lines.push(
      `| ${code(s.alias)} | ${s.status.replace(/_/g, ' ')} | ${s.analysis?.stats.tools ?? '—'} | ${s.analysis?.stats.writes ?? '—'} | ${f.length ? `${f.length}${worst ? ` (worst ${worst})` : ''}` : '—'} |`,
    );
  }
  lines.push('');

  const account = new Map((scan.account?.results ?? []).filter((r) => r.since).map((r) => [r.alias, r.since!]));
  const changes = scan.servers.flatMap((s) => {
    const acc = account.get(s.alias);
    if (acc) return [{ alias: s.alias, key: s.serverKey, severity: acc.severity as Severity, summary: acc.summary, rug: acc.rugPull.length > 0 }];
    const d = s.sinceLastScan;
    return d && !d.unchanged
      ? [{ alias: s.alias, key: s.serverKey, severity: d.severity, summary: d.summary, rug: d.rugPull.length > 0 || d.contract.annotationFlips.some((x) => x.widensPrivilege) }]
      : [];
  });
  if (changes.length) {
    lines.push('**Changed since the last scan**', '');
    for (const c of changes.sort((a, b) => RANK[a.severity] - RANK[b.severity])) {
      const line = `- **${c.severity}** ${code(c.alias)}: ${md(c.summary, 300)}`;
      lines.push(line);
      if (c.rug || c.severity === 'critical') urgent.push({ key: sha(`change|${c.key}|${c.summary}`).slice(0, 16), line });
    }
    lines.push('');
  }

  const findings = scan.servers
    .flatMap((s) => (s.analysis?.findings ?? []).map((f) => ({ ...f, alias: s.alias, serverKey: s.serverKey })))
    .concat(scan.findings.map((f) => ({ ...f, alias: f.server ?? 'stack', serverKey: `stack:${f.server ?? ''}` })))
    .filter((f) => RANK[f.severity] <= RANK.high)
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  if (findings.length) {
    lines.push('**Needs attention**', '');
    for (const f of findings.slice(0, MAX_ROWS)) {
      const line = `- **${f.severity}** ${code(f.alias)}${f.tool ? ` › ${code(f.tool)}` : ''}: ${md(f.detail, 240)}`;
      lines.push(line);
      if (f.severity === 'critical') urgent.push({ key: sha(`finding|${f.serverKey}|${f.kind}|${f.tool}|${f.where}|${f.evidence}`).slice(0, 16), line });
    }
    lines.push('');
  }

  const unread = scan.servers.filter((s) => !s.snapshot);
  if (unread.length) {
    lines.push(`<details><summary>${unread.length} server(s) could not be read</summary>`, '');
    for (const s of unread.slice(0, MAX_ROWS)) lines.push(`- ${code(s.alias)}: ${s.status.replace(/_/g, ' ')}${s.error ? `, ${md(s.error, 160)}` : ''}`);
    lines.push('', '</details>', '');
  }
  return lines;
}

function dependencySection(plan: RemotePlan | null, note: string | null): string[] {
  const lines = ['### Dependencies', ''];
  if (!plan) return [...lines, note ?? 'Not checked on this run.', ''];
  if (!plan.upgrades.length) {
    return [...lines, `Everything lurq tracks is on its latest release${plan.untracked ? ` (${plan.untracked} not yet indexed)` : ''}.`, ''];
  }
  lines.push('| Package | Upgrade | What it removes | Advisories |', '| --- | --- | --- | --- |');
  const order = { 'removes-exports': 0, 'arity-changed': 1, unknown: 2, clean: 3 } as const;
  for (const u of [...plan.upgrades].sort((a, b) => order[a.verdict] - order[b.verdict] || b.advisories - a.advisories).slice(0, MAX_ROWS)) {
    const removes =
      u.verdict === 'removes-exports'
        ? `${u.removed.length} export(s)`
        : u.verdict === 'arity-changed'
          ? 'changed signatures'
          : u.verdict === 'clean'
            ? 'nothing'
            : 'unknown';
    lines.push(`| ${code(u.package)} | ${md(u.fromVersion, 40)} → ${md(u.toVersion, 40)}${u.majorsBehind ? ` (${u.majorsBehind} major)` : ''} | ${removes} | ${u.advisories || '—'} |`);
  }
  if (plan.upgrades.length > MAX_ROWS) lines.push('', `and ${plan.upgrades.length - MAX_ROWS} more.`);
  if (plan.untracked) lines.push('', `${plan.untracked} dependencies are not indexed yet, so they are not covered here.`);
  lines.push('');
  return lines;
}

export function renderDashboardIssue(input: IssueInput): RenderedIssue {
  const urgent: UrgentNote[] = [];
  const content = [
    ...(input.scan ? mcpSection(input.scan, urgent) : ['### MCP servers', '', 'Not scanned on this run.', '']),
    ...dependencySection(input.plan, input.planNote),
  ].join('\n');

  const stamp = `Updated ${input.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC${input.runUrl ? ` by [this run](${input.runUrl})` : ''}.`;
  const body = [
    DASHBOARD_MARKER,
    `## ${DASHBOARD_TITLE}`,
    '',
    `${stamp} This issue is edited in place; lurq comments only when something needs a look today. [Open the dashboard](${input.dashboardUrl}).`,
    '',
    content,
    '<sub>Close this issue to stop lurq updating it. Remove `--github-issue` from the workflow to stop creating it.</sub>',
  ].join('\n');

  // The timestamp is left out, so an unchanged repository is an unchanged hash.
  return { title: DASHBOARD_TITLE, body, hash: sha(content).slice(0, 24), urgent };
}

const HASH_RE = /<!-- lurq:hash:([0-9a-f]+) -->/;
const ALERTED_RE = /<!-- lurq:alerted:([A-Za-z0-9,]*) -->/;

export function readMarkers(body: string): { hash: string | null; alerted: string[] } {
  return {
    hash: HASH_RE.exec(body)?.[1] ?? null,
    alerted: (ALERTED_RE.exec(body)?.[1] ?? '').split(',').filter(Boolean),
  };
}

export function withMarkers(body: string, hash: string, alerted: string[]): string {
  const keys = alerted.slice(-MAX_ALERTED_KEYS).join(',');
  return body.replace(DASHBOARD_MARKER, `${DASHBOARD_MARKER}\n<!-- lurq:hash:${hash} -->\n<!-- lurq:alerted:${keys} -->`);
}

export interface GithubEnv {
  token: string;
  repo: string;
  apiUrl: string;
  fetchImpl?: typeof fetch;
}

export class GithubIssueError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GithubIssueError';
  }
}

export function githubEnvFrom(env: NodeJS.ProcessEnv): GithubEnv | null {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { token, repo, apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '') };
}

async function gh<T>(env: GithubEnv, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await (env.fetchImpl ?? fetch)(`${env.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lurq',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as T;
  if (!res.ok && !(method === 'POST' && path.endsWith('/labels') && res.status === 422)) {
    const message = (data as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new GithubIssueError(
      res.status === 403 || res.status === 404
        ? `GitHub refused (${message}); the workflow needs \`permissions: issues: write\``
        : `GitHub ${res.status}: ${message}`,
      res.status,
    );
  }
  return { status: res.status, data };
}

interface IssueRow {
  number: number;
  state: 'open' | 'closed';
  body: string | null;
  html_url: string;
  pull_request?: unknown;
}

export type IssueAction = 'created' | 'updated' | 'unchanged' | 'closed';

/**
 * Create or refresh the dashboard issue, and comment on anything new and urgent.
 *
 * A closed dashboard issue is left closed: closing it is how a maintainer says
 * "stop", and reopening or recreating it would override them.
 */
export async function upsertDashboardIssue(
  env: GithubEnv,
  rendered: RenderedIssue,
): Promise<{ action: IssueAction; url: string | null; commented: number }> {
  const { data: issues } = await gh<IssueRow[]>(env, 'GET', `/repos/${env.repo}/issues?labels=${DASHBOARD_LABEL}&state=all&per_page=100`);
  const mine = (issues ?? []).filter((i) => !i.pull_request && (i.body ?? '').includes(DASHBOARD_MARKER));
  const open = mine.find((i) => i.state === 'open');

  if (!open) {
    if (mine.length) return { action: 'closed', url: mine[0]!.html_url, commented: 0 };
    await gh(env, 'POST', `/repos/${env.repo}/labels`, { name: DASHBOARD_LABEL, color: '6e40c9', description: 'lurq dependency and MCP dashboard' });
    const { data } = await gh<IssueRow>(env, 'POST', `/repos/${env.repo}/issues`, {
      title: rendered.title,
      body: withMarkers(rendered.body, rendered.hash, rendered.urgent.map((u) => u.key)),
      labels: [DASHBOARD_LABEL],
    });
    // Opening the issue already notifies watchers; a comment would say it twice.
    return { action: 'created', url: data.html_url, commented: 0 };
  }

  const markers = readMarkers(open.body ?? '');
  const fresh = rendered.urgent.filter((u) => !markers.alerted.includes(u.key));
  if (markers.hash === rendered.hash && !fresh.length) return { action: 'unchanged', url: open.html_url, commented: 0 };

  await gh(env, 'PATCH', `/repos/${env.repo}/issues/${open.number}`, {
    body: withMarkers(rendered.body, rendered.hash, [...markers.alerted, ...fresh.map((u) => u.key)]),
  });
  if (fresh.length) {
    await gh(env, 'POST', `/repos/${env.repo}/issues/${open.number}/comments`, {
      body: [`lurq found ${fresh.length === 1 ? 'something' : `${fresh.length} things`} that need a look today:`, '', ...fresh.map((u) => u.line)].join('\n'),
    });
  }
  return { action: 'updated', url: open.html_url, commented: fresh.length ? 1 : 0 };
}
