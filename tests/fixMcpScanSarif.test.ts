/**
 * Assembling a whole scan into Findings: the per-server findings have to learn
 * their alias, the cross-server ones have to survive having none, and the order
 * has to match what the terminal shows.
 */
import { describe, expect, it } from 'vitest';
import { scanFindings, type ScanLike } from '../src/fix/mcpConfig';
import type { McpFinding } from '../src/mcpScan/analyze';
import { toSarif } from '../src/fix/sarif';

const f = (over: Partial<McpFinding> = {}): McpFinding => ({
  kind: 'prompt-injection' as McpFinding['kind'],
  severity: 'high',
  tool: 'create_issue',
  where: 'description',
  detail: 'steers the model',
  evidence: null,
  ...over,
});

const report = (over: Partial<ScanLike> = {}): ScanLike => ({
  servers: [{ alias: 'github', analysis: { findings: [f()] } }],
  findings: [],
  configSources: { github: { file: '.cursor/mcp.json', section: 'mcpServers' } },
  ...over,
});

describe('scanFindings', () => {
  it('gives a per-server finding its alias and its config file', () => {
    const [finding] = scanFindings(report());
    expect(finding!.code).toBe('mcp-prompt-injection:github:create_issue');
    expect(finding!.file).toBe('.cursor/mcp.json');
    expect(finding!.section).toBe('mcpServers.github');
    expect(finding!.detail).toMatch(/^github › create_issue › description:/);
  });

  it('keeps a cross-server finding that belongs to no alias', () => {
    const findings = scanFindings(
      report({ servers: [], findings: [f({ tool: null, where: 'tool name collision' })] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBeUndefined();
    expect(findings[0]!.code).toBe('mcp-prompt-injection:tool name collision');
  });

  it('ignores a server that was never analysed, rather than inventing findings', () => {
    expect(scanFindings(report({ servers: [{ alias: 'unscanned', analysis: null }] }))).toEqual([]);
  });

  it('orders by severity, the way the scan itself does', () => {
    const findings = scanFindings(
      report({
        servers: [
          {
            alias: 'github',
            analysis: {
              findings: [
                f({ severity: 'low', tool: 'a' }),
                f({ severity: 'critical', tool: 'b' }),
                f({ severity: 'moderate', tool: 'c' }),
              ],
            },
          },
        ],
      }),
    );
    expect(findings.map((x) => x.severity)).toEqual(['blocking', 'warning', 'warning']);
    expect(findings[0]!.code).toMatch(/:b$/);
  });

  it('survives a report with no configSources at all', () => {
    const findings = scanFindings(report({ configSources: undefined }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBeUndefined();
  });
});

describe('the SARIF a scan produces', () => {
  it('classes every kind as one rule and fingerprints each occurrence', () => {
    const doc = toSarif(scanFindings(report()), { version: '1.0.0', read: () => null }) as {
      runs: {
        tool: { driver: { rules: { id: string }[] } };
        results: {
          ruleId: string;
          partialFingerprints: { lurqCode: string };
          properties: { fixable: boolean };
        }[];
      }[];
    };
    const run = doc.runs[0]!;
    expect(run.tool.driver.rules.map((r) => r.id)).toEqual(['mcp-prompt-injection']);
    expect(run.results[0]!.ruleId).toBe('mcp-prompt-injection');
    expect(run.results[0]!.partialFingerprints.lurqCode).toBe(
      'mcp-prompt-injection:github:create_issue@.cursor/mcp.json',
    );
    // No rule rewrites a tool description, so nothing here claims to be fixable.
    expect(run.results[0]!.properties.fixable).toBe(false);
  });
});
