/**
 * The pinned dashboard issue: what it says, what it refuses to render, and the
 * GitHub calls it makes, against a mocked API.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScanReport } from '../src/cli/mcpScan';
import type { RemotePlan } from '../src/cli/remote';
import {
  DASHBOARD_MARKER,
  md,
  readMarkers,
  renderDashboardIssue,
  upsertDashboardIssue,
  withMarkers,
  type GithubEnv,
} from '../src/github/dashboardIssue';

const scan = (over: Partial<ScanReport['servers'][number]> = {}): ScanReport =>
  ({
    root: '/repo',
    filesRead: ['.mcp.json'],
    notes: [],
    stack: { overall: 'compatible', members: [], collisions: [], totalTools: 2, estimatedContextTokens: 500, unread: [], note: '' },
    findings: [],
    worst: null,
    account: null,
    uploadProblem: null,
    servers: [
      {
        alias: 'notes',
        serverKey: 'npm:notes-mcp',
        status: 'ok',
        snapshot: { tools: [] },
        analysis: {
          capabilities: {},
          stats: { tools: 2, writes: 1, destroys: 0, openWorld: 2, annotated: 2, capabilities: {} },
          findings: [
            { kind: 'concealment', severity: 'critical', tool: 'add_note', where: 'description', detail: 'ping @octocat and see #12 at https://evil.test', evidence: 'x' },
          ],
        },
        sinceLastScan: null,
        ...over,
      },
    ],
  }) as unknown as ScanReport;

const plan: RemotePlan = {
  upgrades: [
    {
      package: 'zod',
      fromVersion: '3.25.0',
      toVersion: '4.0.0',
      declaredIn: [],
      hops: [],
      majorsBehind: 1,
      advisories: 0,
      deprecated: false,
      verdict: 'removes-exports',
      removed: ['ZodEffects'],
      arityChanged: [],
      typeOnlyRemoved: [],
      newlyDeprecated: [],
    },
  ],
  omitted: 0,
  pending: 0,
  untracked: 3,
};

const input = (over = {}) => ({
  repo: 'acme/app',
  generatedAt: new Date('2026-09-14T06:30:00Z'),
  runUrl: 'https://github.com/acme/app/actions/runs/1',
  dashboardUrl: 'https://lurq.run/dashboard/mcp',
  scan: scan(),
  plan,
  planNote: null,
  ...over,
});

describe('renderDashboardIssue', () => {
  it('renders servers, findings and dependencies', () => {
    const r = renderDashboardIssue(input());
    expect(r.body.startsWith(DASHBOARD_MARKER)).toBe(true);
    expect(r.body).toContain('| `notes` | ok | 2 | 1 | 1 (worst critical) |');
    expect(r.body).toContain('| `zod` | 3.25.0 → 4.0.0 (1 major) | 1 export(s) | — |');
    expect(r.body).toContain('3 dependencies are not indexed yet');
    expect(r.urgent).toHaveLength(1);
  });

  it('never lets server text mention, cross-reference or link', () => {
    const r = renderDashboardIssue(input());
    expect(r.body).not.toMatch(/@octocat/);
    expect(r.body).not.toMatch(/#12\b/);
    expect(r.body).not.toContain('https://evil.test');
    expect(md('[click](https://x.test) <img>')).toBe('\\[click\\](https:​//x.test) \\<img\\>');
  });

  it('keeps the same hash when only the time changed', () => {
    const a = renderDashboardIssue(input());
    const b = renderDashboardIssue(input({ generatedAt: new Date('2026-09-15T06:30:00Z'), runUrl: 'https://github.com/acme/app/actions/runs/2' }));
    expect(a.hash).toBe(b.hash);
    expect(renderDashboardIssue(input({ plan: null, planNote: 'n' })).hash).not.toBe(a.hash);
  });

  it('round-trips its markers', () => {
    const body = withMarkers('x\n' + DASHBOARD_MARKER + '\nrest', 'abc123', ['k1', 'k2']);
    expect(readMarkers(body)).toEqual({ hash: 'abc123', alerted: ['k1', 'k2'] });
  });
});

function github(issues: unknown[]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.github.com', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    if (init.method === 'GET') return new Response(JSON.stringify(issues), { status: 200 });
    if (path.endsWith('/labels')) return new Response(JSON.stringify({ message: 'exists' }), { status: 422 });
    return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/acme/app/issues/7', state: 'open', body: '' }), { status: 201 });
  });
  const env: GithubEnv = { token: 't', repo: 'acme/app', apiUrl: 'https://api.github.com', fetchImpl: fetchImpl as never };
  return { env, calls };
}

describe('upsertDashboardIssue', () => {
  const rendered = renderDashboardIssue(input());

  it('creates the issue with its label when there is none, without an extra comment', async () => {
    const { env, calls } = github([]);
    expect(await upsertDashboardIssue(env, rendered)).toMatchObject({ action: 'created', commented: 0 });
    expect(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'GET /repos/acme/app/issues',
      'POST /repos/acme/app/labels',
      'POST /repos/acme/app/issues',
    ]);
    expect(readMarkers((calls[2]!.body as { body: string }).body).alerted).toEqual(rendered.urgent.map((u) => u.key));
  });

  it('does nothing when nothing changed', async () => {
    const body = withMarkers(rendered.body, rendered.hash, rendered.urgent.map((u) => u.key));
    const { env, calls } = github([{ number: 7, state: 'open', body, html_url: 'u' }]);
    expect((await upsertDashboardIssue(env, rendered)).action).toBe('unchanged');
    expect(calls).toHaveLength(1);
  });

  it('edits in place, and comments once on a new urgent finding', async () => {
    const body = withMarkers(rendered.body, 'oldhash', []);
    const { env, calls } = github([{ number: 7, state: 'open', body, html_url: 'u' }]);
    expect(await upsertDashboardIssue(env, rendered)).toMatchObject({ action: 'updated', commented: 1 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /repos/acme/app/issues?labels=lurq&state=all&per_page=100',
      'PATCH /repos/acme/app/issues/7',
      'POST /repos/acme/app/issues/7/comments',
    ]);
    expect((calls[2]!.body as { body: string }).body).toContain('need a look today');
  });

  it('leaves a closed dashboard issue closed', async () => {
    const { env, calls } = github([{ number: 7, state: 'closed', body: DASHBOARD_MARKER, html_url: 'u' }]);
    expect((await upsertDashboardIssue(env, rendered)).action).toBe('closed');
    expect(calls).toHaveLength(1);
  });

  it('explains a permissions failure', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 }));
    await expect(
      upsertDashboardIssue({ token: 't', repo: 'acme/app', apiUrl: 'https://api.github.com', fetchImpl: fetchImpl as never }, rendered),
    ).rejects.toThrow(/issues: write/);
  });
});
