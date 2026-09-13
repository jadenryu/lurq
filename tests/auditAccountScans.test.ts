/**
 * Answering an audit's MCP servers from the account's own live scans.
 */
import { describe, expect, it } from 'vitest';
import { applyAccountScans, matchDeployment, STALE_AFTER_DAYS } from '../src/audit/accountScans';
import type { AuditItem, AuditReport, InventoryMcpServer } from '../src/audit/types';
import type { AccountDeployment } from '../src/db/mcpScans';
import type { ServerAnalysis } from '../src/mcpScan/analyze';

const NOW = new Date('2026-09-13T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const server = (over: Partial<InventoryMcpServer>): InventoryMcpServer => ({
  alias: 'x',
  kind: 'local',
  packageName: null,
  version: null,
  endpoint: null,
  sources: [],
  ...over,
});

const analysis = (over: Partial<ServerAnalysis> = {}): ServerAnalysis => ({
  capabilities: {},
  findings: [],
  stats: { tools: 4, writes: 2, destroys: 1, openWorld: 4, annotated: 2, capabilities: {} },
  ...over,
});

const deployment = (over: Partial<AccountDeployment>): AccountDeployment => ({
  serverKey: 'local:x',
  alias: 'x',
  lastStatus: 'ok',
  lastError: null,
  lastContentHash: 'hash',
  lastScannedAt: daysAgo(1),
  analysis: analysis(),
  openEvents: 0,
  openWorst: null,
  ...over,
});

const mcpItem = (over: Partial<AuditItem>): AuditItem => ({
  name: 'x',
  unit: 'mcp',
  installed: null,
  latest: null,
  status: 'skipped',
  skipReason: 'not-npm',
  findings: [{ kind: 'contract-drift', severity: 'info', detail: 'lurq cannot read this kind of server' }],
  ...over,
});

function report(items: AuditItem[]): AuditReport {
  const declared = items.filter((i) => i.unit !== 'transitive');
  return {
    root: null,
    items,
    notes: [],
    dataAsOf: NOW.toISOString(),
    coverage: {
      discovered: declared.length,
      answered: declared.filter((i) => i.status === 'answered').length,
      queued: declared.filter((i) => i.status === 'queued').length,
      skipped: declared.filter((i) => i.status === 'skipped').length,
      transitivesChecked: 0,
      treeRead: false,
      vulnComplete: true,
    },
  };
}

describe('matchDeployment', () => {
  it('matches npm by package, remote by host, and the rest by alias', () => {
    const ds = [
      deployment({ serverKey: 'npm:@acme/mcp', alias: 'acme' }),
      deployment({ serverKey: 'remote:mcp.linear.app/sse', alias: 'linear' }),
      deployment({ serverKey: 'local:mine', alias: 'mine' }),
    ];
    expect(matchDeployment(server({ kind: 'npm-stdio', packageName: '@acme/mcp' }), ds)?.alias).toBe('acme');
    expect(matchDeployment(server({ kind: 'remote', endpoint: 'MCP.linear.app' }), ds)?.alias).toBe('linear');
    expect(matchDeployment(server({ alias: 'mine' }), ds)?.alias).toBe('mine');
    // A host that merely shares a prefix is a different server.
    expect(matchDeployment(server({ kind: 'remote', endpoint: 'mcp.linear.application' }), ds)).toBeNull();
  });

  it('prefers the most recent scan when a server has two deployments', () => {
    const ds = [
      deployment({ alias: 'old', lastScannedAt: daysAgo(9) }),
      deployment({ alias: 'x', lastStatus: 'timeout', lastScannedAt: daysAgo(1) }),
    ];
    expect(matchDeployment(server({ alias: 'x' }), [...ds, deployment({ alias: 'x', lastScannedAt: daysAgo(3) })])?.lastStatus).toBe(
      'timeout',
    );
  });
});

describe('applyAccountScans', () => {
  it('answers a server the index skipped, with its findings, and recounts coverage', () => {
    const r = report([
      { name: 'zod', unit: 'npm', installed: '3.0.0', latest: '4.0.0', status: 'answered', findings: [] },
      mcpItem({ name: 'linear' }),
    ]);
    const { report: out, answered } = applyAccountScans(
      r,
      [server({ kind: 'remote', endpoint: 'mcp.linear.app', alias: 'linear' })],
      [
        deployment({
          serverKey: 'remote:mcp.linear.app/sse',
          openEvents: 2,
          openWorst: 'high',
          analysis: analysis({
            findings: [
              { kind: 'concealment', severity: 'high', tool: 'create_issue', where: 'description', detail: 'tells the model to keep something from the user', evidence: 'do not tell the user' },
              { kind: 'oversized_text', severity: 'info', tool: 'x', where: 'description', detail: 'long', evidence: null },
            ],
          }),
        }),
      ],
      NOW,
    );
    expect(answered).toBe(1);
    const item = out.items[1]!;
    expect(item.status).toBe('answered');
    expect(item.skipReason).toBeUndefined();
    expect(item.findings.map((f) => `${f.kind}:${f.severity}`)).toEqual([
      'contract-drift:high',
      'tool-safety:high',
      'privilege:low',
    ]);
    expect(out.coverage).toMatchObject({ answered: 2, skipped: 0 });
    expect(out.notes).toContain('1 MCP server(s) answered from your own live scans');
  });

  it('states the age of an old scan instead of passing it off as current', () => {
    const { report: out } = applyAccountScans(
      report([mcpItem({})]),
      [server({ alias: 'x' })],
      [deployment({ lastScannedAt: daysAgo(STALE_AFTER_DAYS + 6) })],
      NOW,
    );
    expect(out.items[0]!.findings.some((f) => /days ago/.test(f.detail))).toBe(true);
  });

  it('reports a server that was never read successfully without answering it', () => {
    const { report: out, answered } = applyAccountScans(
      report([mcpItem({})]),
      [server({ alias: 'x' })],
      [deployment({ lastStatus: 'auth_required', lastError: 'HTTP 401', lastContentHash: null, analysis: null })],
      NOW,
    );
    expect(answered).toBe(0);
    expect(out.items[0]!.status).toBe('skipped');
    expect(out.items[0]!.findings).toContainEqual(expect.objectContaining({ kind: 'needs-config', detail: expect.stringMatching(/HTTP 401/) }));
  });

  it('caps tool findings and summarises the rest', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      kind: 'model_directive' as const,
      severity: 'moderate' as const,
      tool: `t${i}`,
      where: 'description',
      detail: 'instructs the model',
      evidence: null,
    }));
    const { report: out } = applyAccountScans(report([mcpItem({})]), [server({ alias: 'x' })], [deployment({ analysis: analysis({ findings: many }) })], NOW);
    const tool = out.items[0]!.findings.filter((f) => f.kind === 'tool-safety');
    expect(tool).toHaveLength(6);
    expect(tool[5]!.detail).toMatch(/3 more/);
  });

  it('leaves the report alone when nothing matches or the items do not line up', () => {
    const r = report([mcpItem({})]);
    expect(applyAccountScans(r, [server({ alias: 'other' })], [deployment({})], NOW).answered).toBe(0);
    expect(applyAccountScans(r, [server({}), server({})], [deployment({})], NOW).answered).toBe(0);
  });
});
