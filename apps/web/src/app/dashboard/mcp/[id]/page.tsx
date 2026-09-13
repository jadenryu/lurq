import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, EmptyState, InlineError, Panel, PanelHeader, Row, Rows } from "@/components/dashboard/panel";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { StatRow, StatTile } from "@/components/dashboard/stat-tile";
import { ChangeFeed, FindingRow, StatusChip } from "@/components/dashboard/mcp-parts";
import { buttonVariants } from "@/components/ui/button";
import { loadMcpServer } from "@/lib/dashboard-data";
import { relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "mcp server" };

const panelPad = { "--panel-px": "1.125rem" } as React.CSSProperties;

function annotationChips(annotations: Record<string, unknown> | undefined) {
  // Undeclared hints take the spec defaults, which are NOT benign.
  const readOnly = annotations?.readOnlyHint === true;
  const destructive = annotations?.destructiveHint !== false && !readOnly;
  return (
    <>
      {readOnly ? <Chip tone="good">read-only</Chip> : <Chip tone="warn">can modify</Chip>}
      {destructive && <Chip tone="bad">destructive</Chip>}
    </>
  );
}

export default async function McpServerPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const { data, demo } = await loadMcpServer(id);
  if (!data) notFound();
  const { deployment: d, contract, observations, events } = data;
  const findings = contract?.analysis.findings.filter((f) => f.severity !== "info") ?? [];

  return (
    <div>
      <PageHeader
        title={d.alias}
        subtitle={`${d.serverKey} · ${d.transport} · last scanned ${relativeTime(d.lastScannedAt)}`}
        demo={demo}
        meta={<StatusChip status={d.lastStatus} />}
        action={
          <Link href="/dashboard/mcp" className={buttonVariants({ variant: "outline" })}>
            All servers
          </Link>
        }
      />

      <PageBody>
        {d.lastStatus !== "ok" && d.lastStatus !== "partial" && (
          <InlineError>
            The last scan could not read this server{d.lastError ? `: ${d.lastError}` : "."}
            {contract ? " What follows is the last contract that was read." : ""}
          </InlineError>
        )}

        {contract ? (
          <StatRow>
            <StatTile label="tools" value={contract.analysis.stats.tools} hint={d.serverVersion ? `version ${d.serverVersion}` : undefined} />
            <StatTile label="can modify" value={contract.analysis.stats.writes} hint={`${contract.analysis.stats.annotated} declare annotations`} />
            <StatTile label="can destroy" value={contract.analysis.stats.destroys} />
            <StatTile label="findings" value={findings.length} hint="in what it tells the model" />
          </StatRow>
        ) : (
          <EmptyState title="Never read">
            No scan has completed a handshake with this server yet. Fix what the last scan reported and run{" "}
            <code className="font-mono text-xs">npx lurqrun mcp-scan</code> again.
          </EmptyState>
        )}

        <ChangeFeed events={events} demo={demo} showServer={false} title="changes to this server" />

        {findings.length > 0 && (
          <Panel padding="none">
            <div className="p-[var(--panel-px)] pb-0" style={panelPad}>
              <PanelHeader title="findings" />
            </div>
            <Rows>
              {findings.map((f, i) => (
                <FindingRow key={`${f.kind}-${f.tool}-${i}`} finding={f} />
              ))}
            </Rows>
          </Panel>
        )}

        {contract && (
          <Panel padding="none">
            <div className="p-[var(--panel-px)] pb-0" style={panelPad}>
              <PanelHeader title="tools" trailing={<span className="font-mono text-xs text-ink-2">{contract.tools.length}</span>} />
            </div>
            <Rows>
              {contract.tools.map((t) => (
                <Row key={t.name} className="items-start py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] text-ink">{t.name}</span>
                      {annotationChips(t.annotations)}
                      {(contract.analysis.capabilities[t.name] ?? []).map((c) => (
                        <span key={c.capability} title={c.evidence}>
                          <Chip>{c.capability}</Chip>
                        </span>
                      ))}
                    </div>
                    {t.description && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{t.description}</p>}
                  </div>
                </Row>
              ))}
            </Rows>
          </Panel>
        )}

        {observations.length > 0 && (
          <Panel padding="none">
            <div className="p-[var(--panel-px)] pb-0" style={panelPad}>
              <PanelHeader title="history" />
            </div>
            <Rows>
              {observations.map((o) => (
                <Row key={o.id} className="flex-wrap gap-y-1">
                  <StatusChip status={o.status} />
                  <span className="font-mono text-xs text-ink-2">
                    {relativeTime(o.firstSeenAt)}
                    {o.scanCount > 1 ? ` – ${relativeTime(o.lastSeenAt)}` : ""}
                  </span>
                  <span className="text-xs text-ink-3">
                    {o.scanCount} scan{o.scanCount === 1 ? "" : "s"} · {o.source}
                    {o.serverVersion ? ` · v${o.serverVersion}` : ""}
                  </span>
                  {o.error && <span className="min-w-0 flex-1 truncate text-right text-xs text-ink-3">{o.error}</span>}
                </Row>
              ))}
            </Rows>
          </Panel>
        )}
      </PageBody>
    </div>
  );
}
