import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, EmptyState, InlineError, Panel, PanelHeader, Row, Rows } from "@/components/dashboard/panel";
import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { StatRow, StatTile } from "@/components/dashboard/stat-tile";
import { SeverityChip } from "@/components/dashboard/mcp-parts";
import { PinToggle, PublicAcknowledgeButton } from "@/components/dashboard/public-mcp-controls";
import { buttonVariants } from "@/components/ui/button";
import { loadPublicEndpoint } from "@/lib/dashboard-data";
import { relativeTime } from "@/lib/format";
import type { CompatVerdict, PublicEndpointStatus } from "@/lib/lurq-issuer";

export const metadata: Metadata = { title: "mcp server" };

const panelPad = { "--panel-px": "1.125rem" } as React.CSSProperties;

const STATUS: Record<PublicEndpointStatus, { word: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  open: { word: "answering", tone: "good" },
  auth_required: { word: "needs sign-in", tone: "warn" },
  templated: { word: "needs URL values", tone: "warn" },
  not_found: { word: "not found", tone: "bad" },
  server_error: { word: "server error", tone: "bad" },
  unreachable: { word: "unreachable", tone: "bad" },
  dns_failed: { word: "does not resolve", tone: "bad" },
  timeout: { word: "timed out", tone: "neutral" },
  protocol_error: { word: "not MCP", tone: "neutral" },
  blocked: { word: "not checkable", tone: "neutral" },
};

const DEAD: PublicEndpointStatus[] = ["not_found", "server_error", "unreachable", "dns_failed"];

const VERDICT: Record<CompatVerdict, { word: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  works: { word: "works", tone: "good" },
  needs_setup: { word: "needs setup", tone: "warn" },
  blocked: { word: "blocked", tone: "bad" },
  unknown: { word: "unknown", tone: "neutral" },
};

function StatusChip({ status }: { status: PublicEndpointStatus | null }) {
  if (!status) return <Chip>not probed yet</Chip>;
  const s = STATUS[status] ?? { word: status, tone: "neutral" as const };
  return <Chip tone={s.tone}>{s.word}</Chip>;
}

const yesNo = (label: string, on: boolean) => (
  <Chip tone={on ? "good" : "neutral"} dot={false}>
    {label} {on ? "yes" : "no"}
  </Chip>
);

export default async function PublicMcpServerPage({ params }: { params: Promise<{ endpointId: string }> }) {
  const id = Number((await params).endpointId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const { data, demo } = await loadPublicEndpoint(id);
  if (!data) notFound();
  const { endpoint: e, servers, contract, observations, changes, pin, clients, summary } = data;
  const auth = e.auth;
  const open = changes.filter((c) => !c.acknowledged).length;

  return (
    <div>
      <PageHeader
        title={servers[0] ?? e.host}
        subtitle={`${e.url} · ${e.transport}${e.lastProbedAt ? ` · probed ${relativeTime(e.lastProbedAt)}` : ""}`}
        demo={demo}
        meta={<StatusChip status={e.status} />}
        action={
          <span className="inline-flex items-center gap-2">
            <PinToggle endpointId={e.id} pinned={Boolean(pin)} changed={Boolean(pin && (pin.contractChanged || pin.authChanged))} disabled={demo} />
            <Link href="/dashboard/mcp" className={buttonVariants({ variant: "outline", size: "sm" })}>
              All servers
            </Link>
          </span>
        }
      />

      <PageBody>
        {e.removedAt && <InlineError>No registry entry lists this endpoint any more. What follows is its last known state.</InlineError>}
        {e.status && DEAD.includes(e.status) && (
          <InlineError>
            The endpoint was {STATUS[e.status].word} when last probed{e.lastError ? ` (${e.lastError})` : ""}. Calls to it will fail until it answers again.
          </InlineError>
        )}

        {pin && (pin.contractChanged || pin.authChanged) && (
          <InlineError>
            Changed since you pinned it on {pin.pinnedAt.slice(0, 10)}: {[pin.contractChanged && "its tools", pin.authChanged && "how clients sign in"].filter(Boolean).join(" and ")}. Review the
            changes below, then approve them to re-pin.
          </InlineError>
        )}

        <StatRow>
          <StatTile label="works" value={summary.works} hint="clients, no setup" />
          <StatTile label="needs setup" value={summary.needs_setup} />
          <StatTile label="blocked" value={summary.blocked} />
          <StatTile label="open changes" value={open} hint={pin ? "pinned" : servers.length ? servers.join(", ") : undefined} />
        </StatRow>

        <Panel padding="none">
          <div className="p-[var(--panel-px)] pb-0" style={panelPad}>
            <PanelHeader title="works in" trailing={<span className="font-mono text-xs text-ink-2">{clients.length} clients</span>} />
          </div>
          <Rows>
            {clients.map((c) => (
              <Row key={c.client} className="items-start py-2.5">
                <span className="w-44 shrink-0 text-[13px] text-ink">{c.clientName}</span>
                <Chip tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].word}</Chip>
                <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{c.reason ?? ""}</span>
              </Row>
            ))}
          </Rows>
        </Panel>

        <Panel>
          <PanelHeader title="how clients sign in" />
          {!auth || auth.mode === "unknown" ? (
            <p className="text-[13px] text-ink-2">Not established: the endpoint has not answered a probe.</p>
          ) : auth.mode === "none" ? (
            <p className="text-[13px] text-ink-2">No credentials needed: it answered without any.</p>
          ) : auth.mode === "static" ? (
            <p className="text-[13px] text-ink-2">
              A key or token configured by hand{auth.declaredHeaders.length ? `, sent as ${auth.declaredHeaders.map((h) => h.name).join(", ")}` : ""}. Clients that cannot send custom headers
              cannot connect.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[13px] text-ink-2">
                OAuth sign-in through <span className="font-mono text-ink">{auth.oauth?.issuer ?? auth.oauth?.authorizationServers[0] ?? "an authorization server"}</span>
              </p>
              {auth.oauth && (
                <div className="flex flex-wrap gap-2">
                  {yesNo("Client ID Metadata Documents", auth.oauth.cimd)}
                  {yesNo("Dynamic Client Registration", auth.oauth.dcr)}
                  {yesNo("PKCE S256", auth.oauth.pkceS256)}
                </div>
              )}
            </div>
          )}
          {e.violations.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {e.violations.map((v) => (
                <li key={v.code} className="text-[12.5px] text-ink-2">
                  <Chip tone="warn">spec</Chip> <span className="ml-1">{v.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {changes.length > 0 && (
          <Panel padding="none">
            <div className="p-[var(--panel-px)] pb-0" style={panelPad}>
              <PanelHeader title="changes" trailing={<span className="font-mono text-xs text-ink-2">{open} open</span>} />
            </div>
            <Rows>
              {[...changes]
                .sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || b.createdAt.localeCompare(a.createdAt))
                .map((c) => (
                  <Row key={c.id} className="items-start py-3">
                    <SeverityChip severity={c.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink">
                        <span className="text-ink-3">{c.kind} · </span>
                        {c.summary}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="font-mono text-xs text-ink-3">{relativeTime(c.createdAt)}</span>
                      {c.acknowledged ? <span className="text-xs text-ink-3">acknowledged</span> : <PublicAcknowledgeButton changeId={c.id} endpointId={e.id} disabled={demo} />}
                    </div>
                  </Row>
                ))}
            </Rows>
          </Panel>
        )}

        {contract ? (
          <Panel padding="none">
            <div className="p-[var(--panel-px)] pb-0" style={panelPad}>
              <PanelHeader title="tools" trailing={<span className="font-mono text-xs text-ink-2">{contract.tools.length}</span>} />
            </div>
            <Rows>
              {contract.tools.map((t) => {
                const readOnly = t.annotations?.readOnlyHint === true;
                const destructive = t.annotations?.destructiveHint !== false && !readOnly;
                return (
                  <Row key={t.name} className="items-start py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] text-ink">{t.name}</span>
                        {readOnly ? <Chip tone="good">read-only</Chip> : <Chip tone="warn">can modify</Chip>}
                        {destructive && <Chip tone="bad">destructive</Chip>}
                      </div>
                      {t.description && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{t.description}</p>}
                    </div>
                  </Row>
                );
              })}
            </Rows>
          </Panel>
        ) : (
          <EmptyState title="Tools not readable without signing in">
            lurq reads every endpoint without credentials, so a server that requires sign-in shows how to connect but not its tools. Run{" "}
            <code className="font-mono text-xs">npx lurqrun mcp-scan</code> with your own credentials to see them.
          </EmptyState>
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
                    {o.probeCount > 1 ? ` – ${relativeTime(o.lastSeenAt)}` : ""}
                  </span>
                  <span className="text-xs text-ink-3">
                    {o.probeCount} probe{o.probeCount === 1 ? "" : "s"}
                    {o.httpStatus ? ` · HTTP ${o.httpStatus}` : ""}
                  </span>
                  {o.error && <span className="min-w-0 flex-1 truncate text-right text-xs text-ink-3">{o.error}</span>}
                </Row>
              ))}
            </Rows>
          </Panel>
        )}

        <p className="px-1 text-xs leading-relaxed text-ink-3">
          Read by lurq&apos;s credential-free probe of every remote endpoint in the official MCP registry, the same first request any client sends. Client verdicts come from
          each client&apos;s documentation and source code. Maintainers can ask lurq to stop probing a host at contact@lurq.run.
        </p>
      </PageBody>
    </div>
  );
}
