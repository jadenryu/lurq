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
  servers: {
    alias: string;
    analysis: { findings: McpFinding[] } | null;
    /** `needs_config` is the one status only the user can clear. */
    status?: string;
    error?: string | null;
    hint?: string | null;
  }[];
  /** Cross-server findings, which belong to no single alias. */
  findings: McpFinding[];
  configSources?: Record<string, ItemSource>;
}

/**
 * Servers that cannot start until someone supplies a value.
 *
 * This is the first finding lurq produces that no agent should act on alone.
 * Everything else here is either mechanical or a brief an agent can research;
 * a missing credential is held by exactly one party, and an agent that "fixes"
 * it has invented a secret — so the instruction says where the value comes
 * from as forcefully as it says what to do.
 *
 * `needs_config` covers both an unfilled `${VAR}` in the config and a server
 * that reported a missing setting when it started. Both have the same
 * remedy. `auth_required` is deliberately NOT folded in: it also needs the
 * user, but it needs a sign-in, and one instruction cannot be right for both.
 *
 * Nothing here reads a value. The names come from the scan's own error text,
 * which describes settings that by definition have none.
 */
function needsConfigFindings(report: ScanLike): Finding[] {
  return report.servers
    .filter((s) => s.status === 'needs_config')
    .map((s) => {
      const source = report.configSources?.[s.alias];
      const what = s.error ?? 'it needs configuration that is not set';
      return {
        domain: 'mcp-config' as const,
        code: `mcp-needs-config:${s.alias}`,
        // It does not run at all, which is worse than anything its tools say.
        severity: 'blocking' as const,
        detail: `${s.alias} cannot start: ${what}`,
        ...(source ? { file: source.file, section: `${source.section}.${s.alias}` } : {}),
        ...(s.hint ? { evidence: s.hint } : {}),
        fix: {
          summary: `supply the configuration ${s.alias} needs`,
          task: {
            instruction:
              `Ask the user to supply the missing configuration for ${s.alias} (${what}). ` +
              'Take each value from the user — never from a log, an example file, a previous scan, or a guess — ' +
              'then re-run `lurq mcp-scan`.',
            files: source ? [source.file] : [],
            evidence: s.hint ? [s.hint] : [],
          },
          verify: ['probe' as const],
        },
      };
    });
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
    ...report.servers.flatMap((s) =>
      (s.analysis?.findings ?? []).map((f) => ({ ...f, server: s.alias })),
    ),
    ...report.findings,
  ]);
  // A server that never started produced no findings of its own, and the reason
  // it did not start outranks anything the ones that did start are saying.
  return [
    ...needsConfigFindings(report),
    ...mcpConfigFindings(merged, { sourceFor: (alias) => report.configSources?.[alias] }),
  ];
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
