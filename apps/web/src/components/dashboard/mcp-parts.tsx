import Link from "next/link";
import { Chip, Panel, PanelHeader, Row, Rows } from "@/components/dashboard/panel";
import { AcknowledgeButton } from "@/components/dashboard/mcp-acknowledge";
import { relativeTime } from "@/lib/format";
import type { McpChangeEvent, McpFinding, McpScanStatus, ScanSeverity } from "@/lib/lurq-issuer";

/** Severity to chip tone. Low and info carry no colour: they are not a verdict. */
export function severityTone(s: ScanSeverity | null): "bad" | "warn" | "neutral" {
  return s === "critical" || s === "high" ? "bad" : s === "moderate" ? "warn" : "neutral";
}

export function SeverityChip({ severity }: { severity: ScanSeverity }) {
  return <Chip tone={severityTone(severity)}>{severity}</Chip>;
}

const STATUS_WORDS: Record<McpScanStatus, string> = {
  ok: "read",
  partial: "partly read",
  needs_config: "needs config",
  auth_required: "needs sign-in",
  spawn_failed: "would not start",
  timeout: "timed out",
  unreachable: "unreachable",
  protocol_error: "protocol error",
};

export function StatusChip({ status }: { status: McpScanStatus }) {
  const tone = status === "ok" ? "good" : status === "partial" || status === "needs_config" || status === "auth_required" ? "warn" : "bad";
  return <Chip tone={tone}>{STATUS_WORDS[status] ?? status}</Chip>;
}

/** Capability counts as words, busiest first. */
export function capabilityList(caps: Record<string, number>, max = 3): string {
  const names = Object.entries(caps)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
  if (!names.length) return "—";
  return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", ");
}

export function FindingRow({ finding }: { finding: McpFinding }) {
  return (
    <Row className="items-start">
      <SeverityChip severity={finding.severity} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-ink">
          {finding.tool && <span className="font-mono">{finding.tool}</span>}
          {finding.tool && <span className="text-ink-3"> · {finding.where} · </span>}
          {finding.detail}
        </p>
        {finding.evidence && <p className="mt-1 break-words font-mono text-[11.5px] text-ink-3">{finding.evidence}</p>}
      </div>
    </Row>
  );
}

function ChangeBody({ event }: { event: McpChangeEvent }) {
  const d = event.diff;
  const flips = d.contract.annotationFlips.filter((f) => f.widensPrivilege);
  return (
    <div className="mt-2 space-y-2 text-[12.5px] text-ink-2">
      {d.descriptionChanges.slice(0, 3).map((c) => (
        <div key={`${c.tool}-${c.field}`} className="space-y-1">
          <p>
            <span className="font-mono text-ink">{c.tool}</span> {c.field} changed
            {d.rugPull.includes(c.tool) && <span className="text-ink"> and now instructs the model</span>}
          </p>
          {c.before !== null && <p className="line-clamp-2 font-mono text-[11.5px] text-ink-3 line-through">{c.before}</p>}
          {c.after !== null && <p className="line-clamp-3 font-mono text-[11.5px] text-ink">{c.after}</p>}
        </div>
      ))}
      {flips.map((f) => (
        <p key={`${f.tool}-${f.hint}`}>
          <span className="font-mono text-ink">{f.tool}</span> {f.hint} {String(f.from)} → {String(f.to)}, it can now do
          more than it was approved for
        </p>
      ))}
      {d.contract.removedTools.length > 0 && <p>removed: {d.contract.removedTools.join(", ")}</p>}
      {d.contract.addedTools.length > 0 && <p>added: {d.contract.addedTools.join(", ")}</p>}
    </div>
  );
}

/**
 * The change feed. Open changes first, then by recency, because the one thing
 * this page exists to surface is a server saying something new to the model.
 */
export function ChangeFeed({
  events,
  demo,
  showServer = true,
  title = "changes",
}: {
  events: McpChangeEvent[];
  demo: boolean;
  showServer?: boolean;
  title?: string;
}) {
  if (!events.length) return null;
  const ordered = [...events].sort(
    (a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) || b.createdAt.localeCompare(a.createdAt),
  );
  const open = events.filter((e) => !e.acknowledgedAt).length;
  return (
    <Panel padding="none">
      <div className="p-[var(--panel-px)] pb-0" style={{ "--panel-px": "1.125rem" } as React.CSSProperties}>
        <PanelHeader title={title} trailing={<span className="font-mono text-xs text-ink-2">{open} open</span>} />
      </div>
      <Rows>
        {ordered.map((e) => (
          <Row key={e.id} className="items-start py-3">
            <SeverityChip severity={e.severity} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink">
                {showServer && e.alias && (
                  <Link href={`/dashboard/mcp/${e.deploymentId}`} className="font-mono hover:text-signal">
                    {e.alias}
                  </Link>
                )}
                {showServer && e.alias && <span className="text-ink-3"> · </span>}
                {e.summary}
              </p>
              <ChangeBody event={e} />
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className="font-mono text-xs text-ink-3">{relativeTime(e.createdAt)}</span>
              {e.acknowledgedAt ? (
                <span className="text-xs text-ink-3">acknowledged</span>
              ) : (
                <AcknowledgeButton eventId={e.id} disabled={demo} />
              )}
            </div>
          </Row>
        ))}
      </Rows>
    </Panel>
  );
}
