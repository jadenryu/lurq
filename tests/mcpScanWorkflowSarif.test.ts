/**
 * The code scanning upload in the generated workflow.
 *
 * This file lands in the user's repository and then runs on a schedule without
 * them, so the two properties worth pinning are that it stays off unless asked
 * — the upload fails the job outright on a private repo without Advanced
 * Security — and that when it is on, a failing scan still files its findings.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { renderMcpScanWorkflow } from '../src/github/mcpScanWorkflow';

interface Workflow {
  permissions: Record<string, string>;
  jobs: {
    scan: {
      steps: {
        name?: string;
        uses?: string;
        if?: string;
        run?: string;
        with?: Record<string, string>;
      }[];
    };
  };
}

const wf = (opts: Parameters<typeof renderMcpScanWorkflow>[0] = {}) =>
  parse(renderMcpScanWorkflow(opts)) as Workflow;

const steps = (w: Workflow) => w.jobs.scan.steps;
const upload = (w: Workflow) =>
  steps(w).find((s) => s.uses?.startsWith('github/codeql-action/upload-sarif'));
const scan = (w: Workflow) => steps(w).find((s) => s.run?.includes('mcp-scan'))!;

describe('without --sarif', () => {
  it('asks for no extra permission and adds no upload step', () => {
    const w = wf();
    expect(w.permissions['security-events']).toBeUndefined();
    expect(upload(w)).toBeUndefined();
  });

  it('leaves the scan command untouched', () => {
    expect(scan(wf()).run).not.toContain('--sarif');
  });
});

describe('with --sarif', () => {
  const w = () => wf({ sarif: true });

  it('requests security-events: write, and nothing else new', () => {
    expect(w().permissions).toEqual({
      contents: 'read',
      issues: 'write',
      'security-events': 'write',
    });
  });

  it('writes the file in the scan and reads the same one in the upload', () => {
    expect(scan(w()).run).toContain('--sarif lurq-mcp.sarif');
    expect(upload(w())!.with).toEqual({ sarif_file: 'lurq-mcp.sarif' });
  });

  it('uploads even when the scan failed the job', () => {
    // --fail-on stops the scan step; without always() the run that found
    // something is precisely the run that files nothing.
    expect(upload(w())!.if).toBe('always()');
  });

  it('pins the action, like every other action in this file', () => {
    expect(upload(w())!.uses).toMatch(/^github\/codeql-action\/upload-sarif@v\d+$/);
  });

  it('uploads after the scan, not before it', () => {
    // By position of the step objects: the upload step carries `uses` AND a
    // name, so matching on either key alone finds the wrong thing.
    const list = steps(w());
    const scanAt = list.findIndex((s) => s.run?.includes('mcp-scan'));
    const uploadAt = list.findIndex((s) => s.uses?.startsWith('github/codeql-action/upload-sarif'));
    expect(scanAt).toBeGreaterThanOrEqual(0);
    expect(uploadAt).toBeGreaterThan(scanAt);
  });
});

describe('--sarif with --no-issue', () => {
  it('keeps the issue permission off while adding the alert one', () => {
    expect(wf({ sarif: true, githubIssue: false }).permissions).toEqual({
      contents: 'read',
      'security-events': 'write',
    });
  });
});
