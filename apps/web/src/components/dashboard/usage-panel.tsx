import { BarList, ChartValues, ColumnChart, Sparkline } from "@/components/dashboard/charts";
import { EmptyState, Panel, PanelHeader, eyebrow } from "@/components/dashboard/panel";
import { HeroFigure, RailStat } from "@/components/dashboard/stat-tile";
import { compact, fmtDay } from "@/lib/format";
import type { DashboardUsage } from "@/lib/lurq-issuer";

/**
 * Usage detail: one hero number, the daily trend, a secondary rail of derived
 * stats, and the per-tool split. Every plot is a single monochrome series, so the
 * card eyebrow does the job a legend otherwise would.
 */
export function UsagePanel({ usage, days }: { usage: DashboardUsage; days: number }) {
  const total = usage.series.reduce((s, p) => s + p.count, 0);
  const activeDays = usage.series.filter((p) => p.count > 0).length;
  const peak = usage.series.reduce<{ date: string; count: number } | null>(
    (best, p) => (best === null || p.count > best.count ? p : best),
    null,
  );
  // Average over the window, not over active days, "calls per day" should count
  // the quiet days too, otherwise it overstates steady-state volume.
  const perDay = usage.series.length > 0 ? total / usage.series.length : 0;

  if (total === 0) {
    return (
      <EmptyState title={`No calls in the last ${days} days`}>
        Counted per day and per tool, once your agent starts calling.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {/* items-start so neither card is padded out to the other's height. */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <HeroFigure
              label="total calls"
              value={total}
              hint={`${usage.today.toLocaleString()} today · ${activeDays} of ${usage.series.length} days active`}
            />
          </div>
          <div className="mt-6">
            <ColumnChart data={usage.series} height={168} />
            <ChartValues
              columns={["day", "calls"]}
              rows={usage.series.map((p) => [fmtDay(p.date), p.count])}
            />
          </div>
        </Panel>

        <Panel className="flex flex-col gap-6">
          <RailStat label="trend" value={compact(total)}>
            <Sparkline data={usage.series} />
          </RailStat>
          <div className="h-px w-full bg-border" />
          <RailStat
            label="busiest day"
            value={peak ? peak.count.toLocaleString() : "-"}
          >
            {peak && <p className={eyebrow}>{fmtDay(peak.date)}</p>}
          </RailStat>
          <div className="h-px w-full bg-border" />
          <RailStat label="calls per day" value={perDay.toFixed(perDay < 10 ? 1 : 0)}>
            <p className={eyebrow}>averaged over {usage.series.length} days</p>
          </RailStat>
          <div className="h-px w-full bg-border" />
          <RailStat label="tools used" value={`${usage.byTool.length} of 9`} />
        </Panel>
      </div>

      {usage.byTool.length > 0 && (
        <Panel>
          <PanelHeader
            title="by tool"
            trailing={
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-ink-3">
                last {days} days
              </span>
            }
          />
          <div className="mt-5">
            <BarList items={usage.byTool.map((t) => ({ label: t.tool, count: t.count }))} />
          </div>
        </Panel>
      )}
    </div>
  );
}
