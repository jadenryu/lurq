/**
 * The daily MCP scan workflow and the command that writes it.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { runMcpCi } from '../src/cli/mcpScan';
import {
  MCP_SCAN_WORKFLOW_PATH,
  renderMcpScanWorkflow,
  secretNameFor,
} from '../src/github/mcpScanWorkflow';
import { cliSpec } from '../src/github/workflow';

type Workflow = {
  on: { schedule: { cron: string }[]; pull_request: { paths: string[] } };
  permissions: Record<string, string>;
  jobs: { scan: { steps: { uses?: string; run?: string; env?: Record<string, string> }[] } };
};

const load = (yaml: string) => parse(yaml) as Workflow;
const scanStep = (w: Workflow) => w.jobs.scan.steps.find((s) => s.run?.includes('mcp-scan'))!;

describe('renderMcpScanWorkflow', () => {
  it('is valid YAML, pinned, scans only committed servers, and keeps the dashboard issue', () => {
    const w = load(renderMcpScanWorkflow());
    expect(w.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(w.on.schedule[0]!.cron).toBe('23 6 * * *');
    expect(w.on.pull_request.paths).toContain('.mcp.json');
    const step = scanStep(w);
    expect(step.run).toBe(
      `npx -y ${cliSpec()} mcp-scan --project-only --trust-project --require-upload --github-issue --fail-on high`,
    );
    expect(step.env).toEqual({
      LURQ_API_KEY: '${{ secrets.LURQ_API_KEY }}',
      GITHUB_TOKEN: '${{ github.token }}',
    });
  });

  it('stays read-only without the issue', () => {
    const w = load(renderMcpScanWorkflow({ githubIssue: false }));
    expect(w.permissions).toEqual({ contents: 'read' });
    expect(scanStep(w).run).not.toContain('--github-issue');
    expect(scanStep(w).env).toEqual({ LURQ_API_KEY: '${{ secrets.LURQ_API_KEY }}' });
  });

  it('maps each server credential from a repository secret, never inline', () => {
    const step = scanStep(
      load(
        renderMcpScanWorkflow({
          secrets: ['LINEAR_API_KEY', 'GITHUB_TOKEN', 'bad-name', 'LURQ_API_KEY'],
        }),
      ),
    );
    expect(step.env).toEqual({
      LURQ_API_KEY: '${{ secrets.LURQ_API_KEY }}',
      // A server that reads GITHUB_TOKEN gets its own credential; GitHub reserves GITHUB_* secret names.
      GITHUB_TOKEN: '${{ secrets.MCP_GITHUB_TOKEN }}',
      LINEAR_API_KEY: '${{ secrets.LINEAR_API_KEY }}',
    });
  });

  it('installs uv only when a server needs it', () => {
    const uses = (yaml: string) =>
      load(yaml)
        .jobs.scan.steps.map((s) => s.uses)
        .filter(Boolean);
    expect(uses(renderMcpScanWorkflow())).not.toContain('astral-sh/setup-uv@v6');
    expect(uses(renderMcpScanWorkflow({ needsUv: true }))).toContain('astral-sh/setup-uv@v6');
  });

  it('refuses a malformed schedule', () => {
    expect(() => renderMcpScanWorkflow({ cron: 'daily' })).toThrow(/five fields/);
  });

  it('names reserved secrets under a prefix', () => {
    expect(secretNameFor('GITHUB_PAT')).toBe('MCP_GITHUB_PAT');
    expect(secretNameFor('SLACK_TOKEN')).toBe('SLACK_TOKEN');
  });
});

describe('lurq mcp-ci', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lurq-ci-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('writes the workflow with the secrets the committed servers reference', async () => {
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          linear: {
            type: 'http',
            url: 'https://mcp.linear.app/mcp',
            headers: { Authorization: 'Bearer ${LINEAR_API_KEY}' },
          },
          fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
          gh: { command: 'npx', args: ['-y', 'gh-mcp'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
        },
      }),
    );
    await runMcpCi(root, { failOn: 'moderate' });
    const w = load(readFileSync(join(root, MCP_SCAN_WORKFLOW_PATH), 'utf8'));
    const step = scanStep(w);
    expect(step.run).toContain('--fail-on moderate');
    expect(Object.keys(step.env!).sort()).toEqual([
      'GITHUB_TOKEN',
      'LINEAR_API_KEY',
      'LURQ_API_KEY',
    ]);
    expect(w.jobs.scan.steps.some((s) => s.uses === 'astral-sh/setup-uv@v6')).toBe(true);
  });

  it('omits the issue with --no-issue', async () => {
    await runMcpCi(root, { issue: false });
    expect(load(readFileSync(join(root, MCP_SCAN_WORKFLOW_PATH), 'utf8')).permissions).toEqual({
      contents: 'read',
    });
  });

  it('will not overwrite an existing workflow without --force', async () => {
    await runMcpCi(root, {});
    await expect(runMcpCi(root, {})).rejects.toThrow(/already exists/);
    await runMcpCi(root, { force: true, failOn: 'none' });
    expect(readFileSync(join(root, MCP_SCAN_WORKFLOW_PATH), 'utf8')).toContain('--fail-on none');
  });

  it('prints instead of writing with --print', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runMcpCi(root, { print: true });
    expect(String(write.mock.calls[0]![0])).toContain('name: lurq mcp scan');
    expect(existsSync(join(root, MCP_SCAN_WORKFLOW_PATH))).toBe(false);
  });
});
