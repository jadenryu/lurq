/**
 * The scan-to-Finding adapter, checked on the two mappings that are decisions
 * rather than plumbing: how the 5-level audit scale collapses onto the 3-level
 * fix scale, and how `code` is shaped so the SARIF layer derives the right rule
 * and the right dedup key from it.
 */
import { describe, expect, it } from 'vitest';
import { FIX_SEVERITY, mcpConfigFindings, type ScanFinding } from '../src/fix/mcpConfig';
import { ruleClassOf } from '../src/fix/sarif';

const scan = (over: Partial<ScanFinding> = {}): ScanFinding => ({
  kind: 'prompt-injection' as ScanFinding['kind'],
  severity: 'high',
  server: 'github',
  tool: 'create_issue',
  where: 'description',
  detail: 'instructs the model to ignore previous instructions',
  evidence: 'ignore all previous instructions',
  ...over,
});

const source = () => ({ file: '.cursor/mcp.json', section: 'mcpServers' });

describe('severity', () => {
  it('collapses five levels onto three, with moderate held below blocking', () => {
    expect(FIX_SEVERITY).toEqual({
      critical: 'blocking',
      high: 'blocking',
      moderate: 'warning',
      low: 'warning',
      info: 'info',
    });
  });

  it('carries the mapped level, not the scan level', () => {
    expect(mcpConfigFindings([scan({ severity: 'critical' })])[0]!.severity).toBe('blocking');
    expect(mcpConfigFindings([scan({ severity: 'moderate' })])[0]!.severity).toBe('warning');
    expect(mcpConfigFindings([scan({ severity: 'info' })])[0]!.severity).toBe('info');
  });
});

describe('code', () => {
  it('classes by kind, so two tools are one SARIF rule', () => {
    const codes = mcpConfigFindings([
      scan({ tool: 'create_issue' }),
      scan({ tool: 'delete_repo' }),
    ]).map((f) => f.code);
    expect(new Set(codes.map(ruleClassOf))).toEqual(new Set(['mcp-prompt-injection']));
    // ...but stays distinct per occurrence, or GitHub merges them into one alert.
    expect(new Set(codes).size).toBe(2);
  });

  it('falls back to the field when a finding is not about one tool', () => {
    expect(mcpConfigFindings([scan({ tool: null, where: 'instructions' })])[0]!.code).toBe(
      'mcp-prompt-injection:github:instructions',
    );
  });

  it('survives a finding with no server at all', () => {
    const f = mcpConfigFindings([scan({ server: undefined, tool: null, where: 'collision' })])[0]!;
    expect(f.code).toBe('mcp-prompt-injection:collision');
    expect(f.file).toBeUndefined();
  });
});

describe('location', () => {
  it('names the config file and the key inside it', () => {
    const f = mcpConfigFindings([scan()], { sourceFor: source })[0]!;
    expect(f.file).toBe('.cursor/mcp.json');
    expect(f.section).toBe('mcpServers.github');
  });

  it('reports without a location rather than guessing one', () => {
    const f = mcpConfigFindings([scan()], { sourceFor: () => undefined })[0]!;
    expect(f.file).toBeUndefined();
    expect(f.section).toBeUndefined();
  });
});

describe('the finding itself', () => {
  it('says whose tool and which field, since "description" alone names nobody', () => {
    expect(mcpConfigFindings([scan()])[0]!.detail).toBe(
      'github › create_issue › description: instructs the model to ignore previous instructions',
    );
  });

  it('offers no fix, because no rule rewrites a tool description', () => {
    expect(mcpConfigFindings([scan()])[0]!.fix).toBeUndefined();
  });

  it('is tagged to the config domain', () => {
    expect(mcpConfigFindings([scan()])[0]!.domain).toBe('mcp-config');
  });

  it('passes evidence through, and omits the key when there is none', () => {
    expect(mcpConfigFindings([scan()])[0]!.evidence).toBe('ignore all previous instructions');
    expect(mcpConfigFindings([scan({ evidence: null })])[0]!.evidence).toBeUndefined();
  });
});
