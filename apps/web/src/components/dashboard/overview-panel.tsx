import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BarList, ChartValues, ColumnChart } from "@/components/dashboard/charts";
import { DetailRow } from "@/components/dashboard/expandable-row";
import {
  Chip,
  EmptyState,
  Panel,
  PanelHeader,
  Row,
  Rows,
  microLabel,
} from "@/components/dashboard/panel";
import { Stagger, StaggerItem } from "@/components/dashboard/motion";
import { Delta, StatRow, StatTile } from "@/components/dashboard/stat-tile";
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

/** Percent change, or null when there is no baseline to compare against. */
function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * The layout every drawer uses: the evidence on the left, the derived facts on
 * the right. Fixed, so four drill-downs read as one feature rather than as four
 * little pages that each invented a layout.
 */
function Drill({
  children,
  facts,
  href,
  cta,
}: {
  children: React.ReactNode;
  facts: React.ReactNode;
  href: string;
  cta: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0">{children}</div>
      <div className="min-w-0 lg:border-l lg:border-edge lg:pl-5">
        <div className="space-y-0.5">{facts}</div>
        <div className="mt-3">
          <SectionLink href={href}>{cta}</SectionLink>
        </div>
      </div>
    </div>
  );
}

/**
 * The dashboard's front door: a metric strip you can open, one dominant plot,
 * then a band of dense lists.
 *
 * `days` is the reported window; `data.usage.series` deliberately carries twice
 * that, so every delta on this page is a real period-over-period comparison
 * against the equivalent preceding window rather than a half-of-this-window
 * sleight of hand.
 */
export function OverviewPanel({ data, days }: { data: OverviewData; days: number }) {
  const { keys, usage, outcomes, contributions } = data;
  const activeKeys = keys.filter((k) => !k.revokedAt);

  // Current window and the one before it, from one gap-free series.
  const series = usage.series.slice(-days);
  const previous = usage.series.slice(0, Math.max(usage.series.length - days, 0));
  const total = series.reduce((s, p) => s + p.count, 0);
  const priorTotal = previous.reduce((s, p) => s + p.count, 0);
  const hasBaseline = previous.length >= days;

  const yesterday = series.length >= 2 ? series[series.length - 2]!.count : null;
  const activeDays = series.filter((p) => p.count > 0).length;
  const perDay = series.length > 0 ? total / series.length : 0;
  const peak = series.reduce<{ date: string; count: number } | null>(
    (best, p) => (best === null || p.count > best.count ? p : best),
    null,
  );

  // Outcomes split on the same boundary as the usage series, so acceptance is
  // compared like for like rather than against all history.
  //
  // The boundary comes from the series' own first day rather than from the
  // clock: reading `Date.now()` in render is impure (the React compiler rejects
  // it outright), and deriving it from the data means the split lands exactly on
  // the chart's left edge instead of a few hours either side of it.
  const windowStart = series[0]?.date;
  const cutoff = windowStart ? new Date(windowStart).getTime() : 0;
  const inWindow = outcomes.filter((o) => new Date(o.createdAt).getTime() >= cutoff);
  const before = outcomes.filter((o) => new Date(o.createdAt).getTime() < cutoff);
  const rate = (list: typeof outcomes) =>
    list.length > 0 ? (list.filter((o) => o.accepted).length / list.length) * 100 : null;
  const acceptance = rate(inWindow);
  const priorAcceptance = rate(before);

  const recent = outcomes.slice(0, 6);
  const topPackages = contributions.packages.slice(0, 6);
  const toolTotal = usage.byTool.reduce((s, t) => s + t.count, 0);
  // The per-tool split is not windowed the way the series is — the issuer
  // aggregates it over the whole read, which is the baseline-length window. It
  // therefore says so, rather than borrowing the chart's "last 30 days" and
  // quietly reporting twice as many calls as the chart above it.
  const readDays = usage.series.length;

  return (
    <div className="space-y-4">
      {/* Every tile opens onto what it is made of. A number with no way to ask
          "made of what?" is a poster, and this is the first screen anyone sees. */}
      <StatRow>
        <StatTile
          label="calls today"
          value={usage.today}
          delta={<Delta pct={yesterday === null ? null : change(usage.today, yesterday)} />}
          hint={yesterday === null ? undefined : `${yesterday.toLocaleString()} yesterday`}
          detail={
            <Drill
              href="/dashboard/usage"
              cta="usage detail"
              facts={
                <>
                  <DetailRow label="yesterday">
                    {yesterday === null ? "—" : yesterday.toLocaleString()}
                  </DetailRow>
                  <DetailRow label="daily avg">
                    {perDay.toFixed(perDay < 10 ? 1 : 0)} over {days} days
                  </DetailRow>
                  <DetailRow label="busiest">
                    {peak ? `${peak.count.toLocaleString()} on ${fmtDay(peak.date)}` : "—"}
                  </DetailRow>
                </>
              }
            >
              <p className={microLabel}>last 14 days</p>
              <div className="mt-2.5">
                <ColumnChart data={series.slice(-14)} height={96} />
              </div>
            </Drill>
          }
        />

        <StatTile
          label={`calls · ${days}d`}
          value={total}
          delta={<Delta pct={hasBaseline ? change(total, priorTotal) : null} />}
          hint={
            hasBaseline
              ? `${priorTotal.toLocaleString()} in the previous ${days}d`
              : `${activeDays} of ${series.length} days active`
          }
          detail={
            <Drill
              href="/dashboard/usage"
              cta="usage detail"
              facts={
                <>
                  <DetailRow label="previous">
                    {hasBaseline ? `${priorTotal.toLocaleString()} calls` : "no full baseline yet"}
                  </DetailRow>
                  <DetailRow label="active days">
                    {activeDays} of {series.length}
                  </DetailRow>
                  <DetailRow label="tools used">{usage.byTool.length}</DetailRow>
                </>
              }
            >
              <p className={microLabel}>share by tool · last {readDays} days</p>
              <div className="mt-2.5">
                {usage.byTool.length > 0 ? (
                  <BarList
                    items={usage.byTool.slice(0, 5).map((t) => ({
                      label: t.tool,
                      count: t.count,
                      href: `/dashboard/guide#tool-${t.tool}`,
                    }))}
                  />
                ) : (
                  <p className="text-[13px] text-ink-3">No calls in this window.</p>
                )}
              </div>
            </Drill>
          }
        />

        <StatTile
          label="active keys"
          value={activeKeys.length}
          hint={
            keys.length > activeKeys.length
              ? `${keys.length - activeKeys.length} revoked`
              : "none revoked"
          }
          detail={
            <Drill
              href="/dashboard/keys"
              cta="manage keys"
              facts={
                <>
                  <DetailRow label="in use">
                    {activeKeys.filter((k) => k.lastUsedAt).length} of {activeKeys.length}
                  </DetailRow>
                  <DetailRow label="revoked">{keys.length - activeKeys.length}</DetailRow>
                </>
              }
            >
              <p className={microLabel}>keys on this account</p>
              {activeKeys.length === 0 ? (
                <p className="mt-2.5 text-[13px] text-ink-3">No active keys.</p>
              ) : (
                <ul className="mt-2.5 divide-y divide-edge border-y border-edge">
                  {activeKeys.slice(0, 5).map((k) => (
                    <li key={k.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="truncate font-mono text-[12.5px] text-ink">
                        {k.prefix}…
                      </span>
                      <span className="shrink-0 text-[11.5px] text-ink-3">
                        {k.lastUsedAt ? `used ${relativeTime(k.lastUsedAt)}` : "never used"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Drill>
          }
        />

        <StatTile
          label="acceptance"
          value={acceptance === null ? "—" : `${Math.round(acceptance)}%`}
          delta={
            <Delta
              pct={
                acceptance === null || priorAcceptance === null
                  ? null
                  : acceptance - priorAcceptance
              }
            />
          }
          hint={
            inWindow.length > 0
              ? `${inWindow.filter((o) => o.accepted).length}/${inWindow.length} in ${days}d`
              : "no outcomes yet"
          }
          detail={
            <Drill
              href="/dashboard/activity"
              cta="all activity"
              facts={
                <>
                  <DetailRow label="accepted">
                    {inWindow.filter((o) => o.accepted).length}
                  </DetailRow>
                  <DetailRow label="passed">
                    {inWindow.filter((o) => !o.accepted).length}
                  </DetailRow>
                  <DetailRow label="earlier">
                    {priorAcceptance === null
                      ? "no prior outcomes"
                      : `${Math.round(priorAcceptance)}% before this window`}
                  </DetailRow>
                </>
              }
            >
              <p className={microLabel}>most recent decisions</p>
              {inWindow.length === 0 ? (
                <p className="mt-2.5 text-[13px] text-ink-3">
                  Nothing reported back in this window.
                </p>
              ) : (
                <ul className="mt-2.5 divide-y divide-edge border-y border-edge">
                  {inWindow.slice(0, 5).map((o) => (
                    <li
                      key={`${o.packageName}-${o.createdAt}`}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                        {o.packageName}
                      </span>
                      <Chip tone={o.accepted ? "good" : "neutral"}>
                        {o.accepted ? "accepted" : "passed"}
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}
            </Drill>
          }
        />
      </StatRow>

      <Stagger className="space-y-4" delay={0.06}>
        <StaggerItem>
          <Panel padding="none">
            <div className="flex h-11 items-center justify-between gap-4 border-b border-edge px-[var(--panel-px)]">
              <div className="flex items-baseline gap-2.5">
                <p className="text-[13px] font-medium tracking-[-0.01em] text-ink">requests</p>
                <span className={microLabel}>last {days} days</span>
              </div>
              <SectionLink href="/dashboard/usage">usage detail</SectionLink>
            </div>
            <div className="px-[var(--panel-px)] pb-4 pt-4">
              <ColumnChart data={series} height={200} />
              <ChartValues
                columns={["day", "calls"]}
                rows={series.map((p) => [fmtDay(p.date), p.count])}
              />
            </div>
          </Panel>
        </StaggerItem>

        <StaggerItem>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel>
              <PanelHeader
                title="by tool"
                trailing={
                  <span className={microLabel}>
                    {toolTotal.toLocaleString()} calls · {readDays}d
                  </span>
                }
              />
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
                      <Chip tone={o.accepted ? "good" : "neutral"}>
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
