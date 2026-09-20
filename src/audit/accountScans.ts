/**
 * Answer an audit's MCP servers from the account's own live scans.
 *
 * The index can only read npm servers it managed to probe in a sandbox, so a
 * hosted audit used to skip every remote, PyPI and private server and leave most
 * npm ones queued. The account's scans read every one of those with the user's
 * real configuration. When a scan exists for a server the audit names, it is the
 * better evidence and the item is answered from it — with the scan's age stated,
 * so an old read never passes for a current one.
 */
import type { Database } from '../db/client';
import { listAccountDeployments, type AccountDeployment } from '../db/mcpScans';
import type { McpFinding } from '../mcpScan/analyze';
import {
  SEVERITY_RANK,
  type AuditItem,
  type AuditReport,
  type Finding,
  type InventoryMcpServer,
} from './types';

/** A scan older than this still answers, with its age called out. */
export const STALE_AFTER_DAYS = 14;
/** Tool-safety findings listed per server before summarising the rest. */
const MAX_TOOL_FINDINGS = 5;

const DAY_MS = 86_400_000;

/**
 * The account deployment an inventory server refers to, most recent first.
 *
 * By package for npm, by host for remote servers (the inventory keeps the host
 * only), by alias for everything else. A server configured under two
 * fingerprints yields the most recently scanned one.
 */
export function matchDeployment(
  s: InventoryMcpServer,
  deployments: AccountDeployment[],
): AccountDeployment | null {
  const host = s.endpoint?.toLowerCase();
  const candidates = deployments.filter((d) => {
    if (s.packageName) return d.serverKey === `npm:${s.packageName}`;
    if (s.kind === 'remote' && host)
      return d.serverKey === `remote:${host}` || d.serverKey.startsWith(`remote:${host}/`);
    return d.alias === s.alias;
  });
  return (
    candidates.sort((a, b) => b.lastScannedAt.getTime() - a.lastScannedAt.getTime())[0] ?? null
  );
}

const toolFinding = (f: McpFinding): Finding => ({
  kind: 'tool-safety',
  severity: f.severity,
  detail: `${f.tool ? `${f.tool}: ` : ''}${f.detail}${f.evidence ? ` (${f.evidence.slice(0, 120)})` : ''}`,
});

function enrich(item: AuditItem, d: AccountDeployment, now: Date): void {
  const age = Math.floor((now.getTime() - d.lastScannedAt.getTime()) / DAY_MS);

  if (d.lastStatus === 'needs_config' || d.lastStatus === 'auth_required') {
    item.findings.push({
      kind: 'needs-config',
      severity: 'moderate',
      detail: `your last scan could not connect: ${d.lastError ?? d.lastStatus}`,
    });
  } else if (d.lastStatus !== 'ok' && d.lastStatus !== 'partial') {
    item.findings.push({
      kind: 'contract-drift',
      severity: 'low',
      detail: `your last scan failed (${d.lastStatus}${d.lastError ? `: ${d.lastError}` : ''})`,
    });
  }

  // Never read successfully: the failure above is the whole answer.
  if (!d.lastContentHash || !d.analysis) return;

  if (item.status !== 'answered') {
    item.status = 'answered';
    delete item.skipReason;
    // The "lurq cannot read this kind of server" note no longer applies.
    item.findings = item.findings.filter(
      (f) => !(f.kind === 'contract-drift' && f.severity === 'info'),
    );
  }

  if (age > STALE_AFTER_DAYS) {
    item.findings.push({
      kind: 'contract-drift',
      severity: 'info',
      detail: `answered from your own scan ${age} days ago; run \`lurq mcp-scan\` for a current read`,
    });
  }

  if (d.openEvents > 0) {
    item.findings.push({
      kind: 'contract-drift',
      severity: d.openWorst ?? 'low',
      detail: `${d.openEvents} unacknowledged change(s) to what this server tells your agent; review them in the dashboard`,
    });
  }

  const serious = d.analysis.findings
    .filter((f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK.moderate)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  item.findings.push(...serious.slice(0, MAX_TOOL_FINDINGS).map(toolFinding));
  if (serious.length > MAX_TOOL_FINDINGS) {
    item.findings.push({
      kind: 'tool-safety',
      severity: 'info',
      detail: `${serious.length - MAX_TOOL_FINDINGS} more tool finding(s) in the dashboard`,
    });
  }

  const { tools, writes, destroys } = d.analysis.stats;
  if (destroys > 0 && !item.findings.some((f) => f.kind === 'privilege')) {
    item.findings.push({
      kind: 'privilege',
      severity: 'low',
      detail: `${writes} of ${tools} tools can modify something and ${destroys} can destroy, by their own annotations`,
    });
  }
}

/**
 * Pure: apply the account's deployments to a report assessed from the index.
 * MCP items line up with `servers` by position, which is how assessInventory
 * emits them.
 */
export function applyAccountScans(
  report: AuditReport,
  servers: InventoryMcpServer[],
  deployments: AccountDeployment[],
  now: Date = new Date(),
): { report: AuditReport; answered: number } {
  if (!deployments.length || !servers.length) return { report, answered: 0 };
  const mcpItems = report.items.filter((i) => i.unit === 'mcp');
  if (mcpItems.length !== servers.length) return { report, answered: 0 };

  let answered = 0;
  servers.forEach((s, i) => {
    const d = matchDeployment(s, deployments);
    if (!d) return;
    const item = mcpItems[i]!;
    const before = item.status;
    enrich(item, d, now);
    if (before !== 'answered' && item.status === 'answered') answered++;
  });

  if (answered) {
    const declared = report.items.filter((i) => i.unit !== 'transitive');
    report.coverage = {
      ...report.coverage,
      answered: declared.filter((i) => i.status === 'answered').length,
      queued: declared.filter((i) => i.status === 'queued').length,
      skipped: declared.filter((i) => i.status === 'skipped').length,
    };
    report.notes = [...report.notes, `${answered} MCP server(s) answered from your own live scans`];
  }
  return { report, answered };
}

/** Database glue: read the owner's deployments and apply them. Never throws. */
export async function withAccountScans(
  db: Database,
  ownerId: string | null | undefined,
  report: AuditReport,
  servers: InventoryMcpServer[],
): Promise<AuditReport> {
  if (!ownerId || !servers.length) return report;
  try {
    return applyAccountScans(report, servers, await listAccountDeployments(db, ownerId)).report;
  } catch {
    // The index answer stands on its own; account scans only improve it.
    return report;
  }
}
