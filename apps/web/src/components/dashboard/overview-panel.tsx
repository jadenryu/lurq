import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ChartValues, ColumnChart, BarList } from "@/components/dashboard/charts";
import { Chip, EmptyState, Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import { Stagger, StaggerItem } from "@/components/dashboard/motion";
import { HeroFigure, StatRow, StatTile } from "@/components/dashboard/stat-tile";
import type { OverviewData } from "@/lib/dashboard-data";
import { fmtDay, relativeTime } from "@/lib/format";

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.04em] uppercase text-ink-3 transition-colors hover:text-foreground"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </Link>
  );
}

/**
 * The dashboard's front door: four counters, the volume trend, what the agent has
 * been calling, and the two most recent feeds, enough to answer "is lurq working
 * for me?" without navigating.
 */
export function OverviewPanel({ data, days }: { data: OverviewData; days: number }) {
  const { keys, usage, outcomes, contributions } = data;
  const activeKeys = keys.filter((k) => !k.revokedAt);
  const total = usage.series.reduce((s, p) => s + p.count, 0);
  const decided = outcomes.length;
  const accepted = outcomes.filter((o) => o.accepted).length;
  const acceptance = decided > 0 ? Math.round((accepted / decided) * 100) : null;
  const recent = outcomes.slice(0, 5);
  const topPackages = contributions.packages.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* The counters arrive left to right, then the panels below them in two
          further waves. Each Stagger starts on mount, so the small `delay` on
          the later groups is what makes the page read top-down rather than all
          three rows animating at once. */}
      {/* md, not lg: at 768–1024px this row used to drop to two columns while
          every other page still showed four, so the tiles resized when you
          switched tabs. StatRow owns this everywhere it can; here the stagger
          wrapper needs the grid itself, so the scale is matched by hand. */}
      <Stagger className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StaggerItem>
          {/* Every tile on the landing view goes somewhere. This is the first
              screen anyone sees, and four numbers that do nothing set the
              expectation that the rest of the dashboard is a poster. */}
          <StatTile label="calls today" value={usage.today} href="/dashboard/usage" />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="active keys"
            value={activeKeys.length}
            hint={keys.length > activeKeys.length ? `${keys.length - activeKeys.length} revoked` : undefined}
            href="/dashboard/keys"
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="packages added"
            value={contributions.total}
            hint="first requested by you"
            href="/dashboard/contributions"
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="acceptance"
            value={acceptance === null ? "-" : `${acceptance}%`}
            hint={decided > 0 ? `${accepted}/${decided} recommendations` : "no outcomes yet"}
            href="/dashboard/activity"
          />
        </StaggerItem>
      </Stagger>

      {/* items-start: without it the two cards stretch to equal height and the
          shorter one ends up with a large dead band under its content. */}
      <Stagger className="grid items-start gap-6 lg:grid-cols-3" delay={0.06}>
        <StaggerItem className="lg:col-span-2">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <HeroFigure
                label="total calls"
                value={total}
                hint={`Across the last ${days} days.`}
              />
              <SectionLink href="/dashboard/usage">usage detail</SectionLink>
            </div>
            <div className="mt-6">
              <ColumnChart data={usage.series} />
              <ChartValues
                columns={["day", "calls"]}
                rows={usage.series.map((p) => [fmtDay(p.date), p.count])}
              />
            </div>
          </Panel>
        </StaggerItem>

        <StaggerItem>
          <Panel>
            <PanelHeader title="by tool" />
            <div className="mt-5">
              {usage.byTool.length > 0 ? (
                <BarList
                  layout="stacked"
                  items={usage.byTool.map((t) => ({ label: t.tool, count: t.count }))}
                />
              ) : (
                <EmptyState title="No calls yet">
                  Tool usage appears here once your agent starts querying the index.
                </EmptyState>
              )}
            </div>
          </Panel>
        </StaggerItem>
      </Stagger>

      <Stagger className="grid gap-6 lg:grid-cols-2" delay={0.12}>
        <StaggerItem>
          <Panel>
            <PanelHeader
              title="recent activity"
              trailing={<SectionLink href="/dashboard/activity">all</SectionLink>}
            />
            <div className="mt-5">
              {recent.length === 0 ? (
                <EmptyState title="No activity yet">
                  Outcomes land here once your agent reports whether a recommendation worked.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-border/60">
                  {recent.map((o) => (
                    <li
                      key={`${o.packageName}-${o.createdAt}`}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-sm">{o.packageName}</span>
                      <Chip tone={o.accepted ? "good" : "neutral"} dot>
                        {o.accepted ? "accepted" : "passed"}
                      </Chip>
                      <span className="w-16 shrink-0 text-right font-mono text-[0.65rem] tabular-nums text-ink-3">
                        {relativeTime(o.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </StaggerItem>

        <StaggerItem>
          <Panel>
            <PanelHeader
              title="your contributions"
              trailing={<SectionLink href="/dashboard/contributions">all</SectionLink>}
            />
            <div className="mt-5">
              {topPackages.length === 0 ? (
                <EmptyState title="No contributions yet">
                  Evaluate a package nobody has asked lurq about, and you get the credit here.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-border/60">
                  {topPackages.map((p) => (
                    <li
                      key={p.name}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-sm">{p.name}</span>
                      {p.category && <Chip>{p.category}</Chip>}
                      <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {p.healthScore ?? "-"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </StaggerItem>
      </Stagger>

      <p className={eyebrow}>
        scores are computed from public signals · never editorial
      </p>
    </div>
  );
}
