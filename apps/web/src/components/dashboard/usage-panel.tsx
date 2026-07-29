import type { DashboardUsage } from "@/lib/lurq-issuer";

const eyebrow = "font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground/70";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a 'YYYY-MM-DD' day without going through Date (avoids TZ off-by-one). */
function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

function StatTiles({ usage }: { usage: DashboardUsage }) {
  const total = usage.series.reduce((s, p) => s + p.count, 0);
  const activeDays = usage.series.filter((p) => p.count > 0).length;
  const tiles = [
    { label: "calls today", value: usage.today },
    { label: "last 30 days", value: total },
    { label: "active days", value: activeDays },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="panel-lit rounded-[var(--radius-xl)] border border-border p-4 md:p-5">
          <p className={eyebrow}>{t.label}</p>
          <p className="mt-2 font-heading text-3xl font-medium tabular-nums tracking-tight md:text-4xl">
            {t.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Single-series magnitude-over-time bars (one ink color, per the design system's
 *  monochrome language). Native <title> tooltips give per-bar hover with no JS. */
function UsageChart({ series }: { series: { date: string; count: number }[] }) {
  const max = Math.max(...series.map((p) => p.count), 1);
  const W = 640;
  const H = 132;
  const pad = 8;
  const n = series.length;
  const gap = n > 1 ? 2 : 0;
  const barW = (W - pad * 2 - gap * (n - 1)) / n;
  const baseline = H - 6;
  const plotH = baseline - 6;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full text-foreground"
      role="img"
      aria-label="Daily lurq calls over the selected window"
      preserveAspectRatio="none"
    >
      {series.map((p, i) => {
        const h = p.count === 0 ? 0 : Math.max(2, (p.count / max) * plotH);
        const x = pad + i * (barW + gap);
        return (
          <g key={p.date}>
            <title>{`${fmtDay(p.date)}: ${p.count.toLocaleString()} call${p.count === 1 ? "" : "s"}`}</title>
            {h > 0 ? (
              <rect x={x} y={baseline - h} width={barW} height={h} rx={Math.min(3, barW / 2)} className="fill-current" />
            ) : (
              <rect x={x} y={baseline - 1} width={barW} height={1} className="fill-current opacity-20" />
            )}
          </g>
        );
      })}
      <line x1={pad} y1={baseline} x2={W - pad} y2={baseline} className="stroke-current opacity-15" strokeWidth={1} />
    </svg>
  );
}

/** Per-tool totals as single-hue magnitude bars with direct labels — categorical
 *  identity carried by the label, never by cycling colors. */
function ToolBreakdown({ byTool }: { byTool: { tool: string; count: number }[] }) {
  const max = Math.max(...byTool.map((t) => t.count), 1);
  return (
    <div className="space-y-2.5">
      {byTool.map((t) => (
        <div key={t.tool} className="flex items-center gap-3">
          <span className="w-24 shrink-0 font-mono text-xs lowercase tracking-wide text-muted-foreground">
            {t.tool}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-sm bg-muted/40">
            <div className="h-full rounded-sm bg-foreground/70" style={{ width: `${(t.count / max) * 100}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">
            {t.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export function UsagePanel({ usage }: { usage: DashboardUsage }) {
  const hasData = usage.series.some((p) => p.count > 0) || usage.byTool.length > 0;
  if (!hasData) {
    return (
      <div className="panel-lit rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
        <p className="text-sm text-muted-foreground">
          No calls yet — connect a client and start using lurq to see your usage here.
        </p>
      </div>
    );
  }

  const first = usage.series[0]?.date;
  const last = usage.series[usage.series.length - 1]?.date;

  return (
    <div className="space-y-8">
      <StatTiles usage={usage} />

      {usage.series.length > 0 && (
        <div className="panel-lit rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
          <p className={eyebrow}>calls per day</p>
          <div className="mt-5">
            <UsageChart series={usage.series} />
          </div>
          {first && last && (
            <div className="mt-2 flex justify-between font-mono text-[0.65rem] text-muted-foreground/60">
              <span>{fmtDay(first)}</span>
              <span>{fmtDay(last)}</span>
            </div>
          )}
        </div>
      )}

      {usage.byTool.length > 0 && (
        <div className="panel-lit rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
          <p className={eyebrow}>by tool</p>
          <div className="mt-5">
            <ToolBreakdown byTool={usage.byTool} />
          </div>
        </div>
      )}
    </div>
  );
}
