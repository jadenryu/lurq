/**
 * MCP scan findings in the one Finding shape.
 *
 * The scan already detects what it detects well; this is an adapter, not a
 * second detector. Once a config problem is a `Finding` it inherits everything
 * built for upgrade findings — SARIF alerts with dedup and a lifecycle, the
 * same severity vocabulary, the same reporting — without the scan growing its
 * own copy of any of it.
 *
 * Two mappings here are decisions rather than plumbing, and both are easy to
 * get silently wrong:
 *
 *   - severity scales differ. The scan speaks the 5-level audit scale
 *     (critical…info); a Finding speaks 3 (blocking/warning/info). Collapsing
 *     them needs a stated rule, not a cast, because it decides what fails a
 *     build.
 *   - `code` puts the CLASS first and the instance after, because the SARIF
 *     layer takes everything before the first colon as the rule id and the
 *     whole string as the dedup fingerprint. Class-only codes would merge two
 *     unrelated tools into one alert; instance-only codes would create a rule
 *     per tool.
 *
 * Nothing here carries a `fix`. A prompt injection in a tool description is not
 * something a rule rewrites, and a Finding with no fix is still worth
 * returning — it says what is wrong when nothing can be done automatically,
 * which is most of the value of an honest report.
 *
 * Secrets: a finding may name a variable, never a value. `ServerSpec.secrets`
 * and any `RequiredConfig` marked secret are deliberately not read here.
 */
import type { ItemSource, Severity } from '../audit/types';
import { sortFindings, type McpFinding } from '../mcpScan/analyze';
import type { Finding, FixSeverity } from './types';

/**
 * The audit scale, collapsed onto the fix scale.
 *
 * `moderate` lands on warning rather than blocking on purpose: the scan raises
 * moderate findings for things like a tool description that changed wording,
 * and a gate that fails a build for that gets switched off entirely — which
 * costs more than the finding is worth.
 */
export const FIX_SEVERITY: Record<Severity, FixSeverity> = {
  critical: 'blocking',
  high: 'blocking',
  moderate: 'warning',
  low: 'warning',
  info: 'info',
};

/** A scan finding carries its server alias once it has been merged across servers. */
export type ScanFinding = McpFinding & { server?: string };

/**
 * Where the finding is, in words: server, then tool, then the field inside it.
 * `where` alone ("inputSchema.path.description") does not say whose.
 */
function label(f: ScanFinding): string {
  return [f.server, f.tool, f.where].filter(Boolean).join(' › ');
}

export interface McpConfigOptions {
  /**
   * The config file an alias came from. Absent is fine and common — a
   * cross-server finding belongs to no single file — and a Finding with no file
   * is reported without a location rather than pointed at a guess.
   */
  sourceFor?: (alias: string) => ItemSource | undefined;
}

/**
 * Just enough of a scan report to adapt, named structurally so this module
 * never imports the CLI it serves.
 */
export interface ScanLike {
  servers: { alias: string; analysis: { findings: McpFinding[] } | null }[];
  /** Cross-server findings, which belong to no single alias. */
  findings: McpFinding[];
  configSources?: Record<string, ItemSource>;
}

/**
 * Every finding in a scan, as Findings.
 *
 * The per-server and cross-server lists are merged and ordered with the scan's
 * own `sortFindings`, so a SARIF report and the terminal output cannot disagree
 * about which finding matters most.
 */
export function scanFindings(report: ScanLike): Finding[] {
  const merged = sortFindings([
    // A per-server finding only knows its alias from the server it came from.
    ...report.servers.flatMap((s) => (s.analysis?.findings ?? []).map((f) => ({ ...f, server: s.alias }))),
    ...report.findings,
  ]);
  return mcpConfigFindings(merged, { sourceFor: (alias) => report.configSources?.[alias] });
}

export function mcpConfigFindings(findings: ScanFinding[], opts: McpConfigOptions = {}): Finding[] {
  return findings.map((f) => {
    const source = f.server ? opts.sourceFor?.(f.server) : undefined;
    // Class first, instance after: `mcp-<kind>` is the rule, the rest is which
    // occurrence. `where` stands in when a finding is not about one tool.
    const instance = [f.server, f.tool ?? f.where].filter(Boolean).join(':');
    return {
      domain: 'mcp-config' as const,
      code: instance ? `mcp-${f.kind}:${instance}` : `mcp-${f.kind}`,
      severity: FIX_SEVERITY[f.severity],
      detail: `${label(f)}: ${f.detail}`,
      ...(source ? { file: source.file, section: `${source.section}.${f.server}` } : {}),
      ...(f.evidence ? { evidence: f.evidence } : {}),
    };
  });
}
