import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, InlineError, Panel, PanelHeader, Row, Rows } from "@/components/dashboard/panel";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { StatRow, StatTile } from "@/components/dashboard/stat-tile";
import { ChangeFeed, SeverityChip, StatusChip, capabilityList } from "@/components/dashboard/mcp-parts";
import { CopyButton } from "@/components/dashboard/copy-button";
import { loadMcpServers } from "@/lib/dashboard-data";
import { relativeTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "mcp servers",
  description: "What every MCP server your agents use actually exposes, and what changed.",
};

const SCAN = "npx lurqrun mcp-scan";
const CI = "npx lurqrun mcp-ci";

/**
 * Every server the account's scans have read, whatever kind: remote, npm, PyPI,
 * Docker, private. Read with the user's own configuration by their CLI or CI,
 * so this is the contract their agents actually receive.
 */
export default async function McpServersPage() {
  const { data, demo, failed } = await loadMcpServers();
  const { servers, events } = data;

  const tools = servers.reduce((n, s) => n + (s.toolCount ?? 0), 0);
  const writes = servers.reduce((n, s) => n + (s.writes ?? 0), 0);
  const open = events.filter((e) => !e.acknowledgedAt);
  const unreadable = servers.filter((s) => s.lastStatus !== "ok" && s.lastStatus !== "partial").length;

  return (
    <div>
      <PageHeader
        title="mcp servers"
        subtitle="What every server your agents connect to really exposes, and what changed since you last looked."
        demo={demo}
        action={<CopyButton label="Copy scan command" copiedLabel="Copied" text={SCAN} />}
      />

      <PageBody>
        {failed && <InlineError>The scan history could not be loaded right now. Your scans are still being recorded.</InlineError>}

        {servers.length === 0 ? (
          <EmptyState title="No scans yet">
            Run <code className="font-mono text-xs">{SCAN}</code> in a project. It connects to every MCP server
            you have configured, with your own settings, and records what each one exposes here. Then{" "}
            <code className="font-mono text-xs">{CI}</code> writes a workflow that rescans daily, so a server
            that changes what it tells your agent is caught the day it happens.
          </EmptyState>
        ) : (
          <>
            <StatRow>
              <StatTile label="servers" value={servers.length} hint={unreadable ? `${unreadable} could not be read last scan` : "all read last scan"} />
              <StatTile label="tools" value={tools} hint="in your agents' context on every request" />
              <StatTile label="can modify" value={writes} hint="by their own annotations; undeclared counts" />
              <StatTile
                label="open changes"
                value={open.length}
                hint={open.length ? `worst: ${open.map((e) => e.severity).sort((a, b) => RANK[a] - RANK[b])[0]}` : "nothing new"}
              />
            </StatRow>

            <ChangeFeed events={events} demo={demo} />

            <Panel padding="none">
              <div className="p-[var(--panel-px)] pb-0" style={{ "--panel-px": "1.125rem" } as React.CSSProperties}>
                <PanelHeader title="servers" />
              </div>
              <Rows>
                {servers.map((s) => (
                  <Row key={s.id} className="flex-wrap gap-y-1.5 py-2.5">
                    <Link href={`/dashboard/mcp/${s.id}`} className="min-w-[10rem] font-mono text-[13px] text-ink hover:text-signal">
                      {s.alias}
                    </Link>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">{s.serverKey}</span>
                    <StatusChip status={s.lastStatus} />
                    {s.openWorst && <SeverityChip severity={s.openWorst} />}
                    <span className="w-24 text-right font-mono text-xs text-ink-2">
                      {s.toolCount === null ? "—" : `${s.toolCount} tools`}
                    </span>
                    <span className="hidden w-56 truncate text-xs text-ink-3 min-[1100px]:inline">{capabilityList(s.capabilities)}</span>
                    <span className="w-20 text-right font-mono text-xs text-ink-3">{relativeTime(s.lastScannedAt)}</span>
                  </Row>
                ))}
              </Rows>
            </Panel>
          </>
        )}
      </PageBody>
    </div>
  );
}

const RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
