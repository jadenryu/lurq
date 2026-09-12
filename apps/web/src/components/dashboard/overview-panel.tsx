import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ChartValues, ColumnChart, BarList } from "@/components/dashboard/charts";
import { Chip, EmptyState, Panel, PanelHeader, Row, Rows, microLabel } from "@/components/dashboard/panel";
import { Stagger, StaggerItem } from "@/components/dashboard/motion";
import { StatRow, StatTile } from "@/components/dashboard/stat-tile";
import type { OverviewData } from "@/lib/dashboard-data";
import { fmtDay, relativeTime } from "@/lib/format";

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 transition-colors hover:text-ink ${microLabel}`}
    >
      {children}
      <ArrowUpRight className="size-3" />
    </Link>
  );
}

/**
 * The dashboard's front door, laid out as a console rather than a card wall:
 * one metric strip, one dominant plot, then a three-up band of dense lists.
 *
 * The old shape was six equal-weight cards in three stacked rows, which asked the
 * reader to decide what mattered. A strip at the top, a chart that owns the fold,
 * and short lists underneath answers "is lurq working for me?" in the order the
 * question is actually asked.
 */
export function OverviewPanel({ data, days }: { data: OverviewData; days: number }) {
  const { keys, usage, outcomes, contributions } = data;
  const activeKeys = keys.filter((k) => !k.revokedAt);
  const total = usage.series.reduce((s, p) => s + p.count, 0);
  const decided = outcomes.length;
  const accepted = outcomes.filter((o) => o.accepted).length;
  const acceptance = decided > 0 ? Math.round((accepted / decided) * 100) : null;
  const recent = outcomes.slice(0, 6);
  const topPackages = contributions.packages.slice(0, 6);

  return (
    <div className="space-y-4">
      <StatRow>
        {/* Every tile on the landing view goes somewhere. This is the first screen
            anyone sees, and four numbers that do nothing set the expectation that
            the rest of the dashboard is a poster. */}
        <StatTile label="calls today" value={usage.today} href="/dashboard/usage" />
        <StatTile
          label={`calls · ${days}d`}
          value={total}
          hint={`${(total / Math.max(usage.series.length, 1)).toFixed(total < 1000 ? 1 : 0)} / day avg`}
          href="/dashboard/usage"
        />
        <StatTile
          label="active keys"
          value={activeKeys.length}
          hint={keys.length > activeKeys.length ? `${keys.length - activeKeys.length} revoked` : undefined}
          href="/dashboard/keys"
        />
        <StatTile
          label="acceptance"
          value={acceptance === null ? "—" : `${acceptance}%`}
          hint={decided > 0 ? `${accepted}/${decided} recommendations` : "no outcomes yet"}
          href="/dashboard/activity"
        />
      </StatRow>

      <Stagger className="space-y-4" delay={0.06}>
        <StaggerItem>
          {/* Full width, and the only plot on the page. A trend line squeezed into
              two thirds of a 1024px column next to a bar list was the reason it
              read as a widget instead of as the page's subject. */}
          <Panel padding="none">
            <div className="flex h-11 items-center justify-between gap-4 border-b border-edge px-[var(--panel-px)]">
              <div className="flex items-baseline gap-2.5">
                <p className="text-[13px] font-medium tracking-[-0.01em] text-ink">requests</p>
                <span className={microLabel}>last {days} days</span>
              </div>
              <SectionLink href="/dashboard/usage">usage detail</SectionLink>
            </div>
            <div className="px-[var(--panel-px)] pb-4 pt-4">
              <ColumnChart data={usage.series} height={200} />
              <ChartValues
                columns={["day", "calls"]}
                rows={usage.series.map((p) => [fmtDay(p.date), p.count])}
              />
            </div>
          </Panel>
        </StaggerItem>

        <StaggerItem>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel>
              <PanelHeader title="by tool" />
              {usage.byTool.length > 0 ? (
                <BarList
                  layout="stacked"
                  items={usage.byTool.slice(0, 6).map((t) => ({
                    label: t.tool,
                    count: t.count,
                    href: `/dashboard/guide#tool-${t.tool}`,
                  }))}
                />
              ) : (
                <EmptyState title="No calls yet">
                  Tool usage appears here once your agent starts querying the index.
                </EmptyState>
              )}
            </Panel>

            <Panel padding="none">
              <PanelHeader
                title="recent activity"
                trailing={<SectionLink href="/dashboard/activity">all</SectionLink>}
                className="mx-0 mt-0 mb-0 px-[var(--panel-px)]"
              />
              {recent.length === 0 ? (
                <div className="p-[var(--panel-px)]">
                  <EmptyState title="No activity yet">
                    Outcomes land here once your agent reports whether a recommendation
                    worked.
                  </EmptyState>
                </div>
              ) : (
                <Rows>
                  {recent.map((o) => (
                    <Row key={`${o.packageName}-${o.createdAt}`}>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                        {o.packageName}
                      </span>
                      <Chip tone={o.accepted ? "good" : "neutral"} dot>
                        {o.accepted ? "accepted" : "passed"}
                      </Chip>
                      <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-3">
                        {relativeTime(o.createdAt)}
                      </span>
                    </Row>
                  ))}
                </Rows>
              )}
            </Panel>

            <Panel padding="none">
              <PanelHeader
                title="your contributions"
                trailing={<SectionLink href="/dashboard/contributions">all</SectionLink>}
                className="mx-0 mt-0 mb-0 px-[var(--panel-px)]"
              />
              {topPackages.length === 0 ? (
                <div className="p-[var(--panel-px)]">
                  <EmptyState title="No contributions yet">
                    Evaluate a package nobody has asked lurq about, and you get the credit
                    here.
                  </EmptyState>
                </div>
              ) : (
                <Rows>
                  {topPackages.map((p) => (
                    <Row key={p.name}>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                        {p.name}
                      </span>
                      {p.category && <Chip>{p.category}</Chip>}
                      <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-2">
                        {p.healthScore ?? "—"}
                      </span>
                    </Row>
                  ))}
                </Rows>
              )}
            </Panel>
          </div>
        </StaggerItem>
      </Stagger>

      <p className={microLabel}>scores are computed from public signals · never editorial</p>
    </div>
  );
}
