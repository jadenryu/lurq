import drift from "@/content/generated/drift.json";
import { Mark } from "@/components/site/wordmark";
import {
  DRIFT_BODY,
  DRIFT_HEAD_1,
  DRIFT_HEAD_2,
  DRIFT_LABEL,
  DRIFT_STAT_SHARE,
  DRIFT_STAT_TRACKED,
  driftNote,
  driftStatDrifted,
} from "@/content/copy";

/**
 * What moved since the model was trained, as a surface rather than as a table.
 *
 * Every row is a package that was on one major at the reference date and is on a
 * different one now, ranked by weekly installs. A model trained on or before that
 * date answers with the struck number, fluently, and cannot know it is stale.
 *
 * It is chromed like a real panel because a bare <table> dropped onto a marketing
 * page reads as an afterthought no matter how good the data is: a title bar that
 * says what is being looked at, a live indicator, a share bar behind each install
 * count so the ranking is visible as shape and not only as digits, and a footer
 * that says where the numbers came from and when.
 *
 * The bar is drawn as an SVG rect rather than a div so it sits on the same
 * baseline grid as the digits at any zoom, and it is aria-hidden because the
 * number beside it already says the value.
 *
 * All of it is one read-only SELECT against lurq's own index
 * (scripts/gen-drift.ts), refreshed daily. The totals cover the whole tracked
 * set, not the eight rows shown, so the sample is never mistaken for the finding.
 */

type Row = {
  name: string;
  version_then: string;
  version_now: string;
  majors_since: number;
  bumped_at: string;
  weekly_downloads: number;
};

const ROWS = drift.rows as Row[];
const { drifted, tracked } = drift.totals;
const PERCENT = Math.round((drifted / tracked) * 100);
const PEAK = Math.max(...ROWS.map((r) => r.weekly_downloads));

function downloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// Both dates arrive as UTC (a date-only string parses as UTC midnight) and are
// formatted as UTC. Left to the local zone, a cutoff of 2025-03-01 renders as
// "feb 2025" anywhere west of Greenwich, which is a page about being a month
// behind getting the month wrong.
function month(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
    .toLowerCase();
}

function synced(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d
    .toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .toLowerCase();
}

const cell = "px-3 py-3.5 text-[13px] whitespace-nowrap";
const head =
  "px-3 py-3 text-[10px] font-normal uppercase tracking-[0.14em] text-ink-3 whitespace-nowrap";

/** One summary stat. Same face, same size, same rhythm for all three. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-surface px-5 py-6 min-[720px]:px-6 min-[720px]:py-7">
      <p
        className="font-sans font-medium leading-none text-ink"
        style={{ fontSize: "clamp(1.75rem, 2.6vw, 2.125rem)", letterSpacing: "-0.035em" }}
      >
        {value}
      </p>
      <p className="mt-3 font-mono text-[11px] leading-[1.6] text-ink-3">{label}</p>
    </div>
  );
}

export function DriftBoard() {
  return (
    <section id="drift" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="mx-auto max-w-[64ch] text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
            {DRIFT_LABEL}
          </p>
          <h2
            className="mt-5 font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.028em",
            }}
          >
            <span className="block">{DRIFT_HEAD_1}</span>
            <span className="block text-ink-3">{DRIFT_HEAD_2}</span>
          </h2>
          <p className="mt-6 text-[15px] leading-[1.65] text-ink-2">{DRIFT_BODY}</p>
        </div>

        {/* The panel. Soft lift only — flat ground already separates it. */}
        <div
          style={{ boxShadow: "0 24px 48px rgba(0,0,0,.35)" }}
          className="mt-14 overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface"
        >
          {/* Title bar. */}
          <div className="flex items-center gap-3 border-b border-edge bg-surface-2 px-4 py-3 min-[720px]:px-5">
            <span className="text-ink">
              <Mark size={14} />
            </span>
            <span className="font-mono text-[12px] text-ink">version drift</span>
            <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-ink-3">
              <span aria-hidden className="room-wire-beat size-1.5 rounded-full" />
              synced {synced(drift.generatedAt)}
            </span>
          </div>

          {/* Summary strip. Three stats at one size, left to right as the
              arithmetic runs: the share, the count it came from, the base. A
              headline number twice the size of the two that derive it reads as
              a pull quote rather than as a measurement. */}
          <div className="grid gap-px border-b border-edge bg-edge min-[560px]:grid-cols-3">
            <Stat value={`${PERCENT}%`} label={DRIFT_STAT_SHARE} />
            <Stat value={drifted.toLocaleString()} label={driftStatDrifted(month(drift.cutoff))} />
            <Stat value={tracked.toLocaleString()} label={DRIFT_STAT_TRACKED} />
          </div>

          {/* The rows. Scrolls sideways rather than dropping columns: a board
              missing a column is a board you cannot check. */}
          <div className="room-drift-scroll overflow-x-auto">
            {/* table-fixed plus an explicit colgroup, so the columns land in the
                same place whatever the day's data is. Left to auto layout the
                widths follow the longest package name, which is why the board
                looked hand-placed differently on every refresh. */}
            <table className="w-full min-w-[880px] table-fixed border-collapse text-left font-mono">
              <caption className="sr-only">
                Packages that changed major version since {drift.cutoff}, by weekly installs
              </caption>
            {/* Every column is fixed except installs, so the slack lands in the
                bar rather than as 300px of empty space beside the package name. */}
              <colgroup>
                <col className="w-[64px]" />
                {/* Narrower before the board fits, so the two version columns
                    (the whole argument) are the first thing scrolled to. */}
                <col className="w-[180px] min-[928px]:w-[260px]" />
                <col className="w-[148px]" />
                <col className="w-[148px]" />
                <col className="w-[92px]" />
                <col className="w-[124px]" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b border-edge bg-surface-2/40">
                  <th scope="col" className={`${head} pl-5`}>
                    <span className="sr-only">Rank</span>
                  </th>
                  <th scope="col" className={head}>
                    Package
                  </th>
                  <th scope="col" className={head}>
                    Model believes
                  </th>
                  <th scope="col" className={head}>
                    Actually on
                  </th>
                  <th scope="col" className={`${head} text-right`}>
                    Majors
                  </th>
                  <th scope="col" className={head}>
                    Shipped
                  </th>
                  <th scope="col" className={`${head} pr-5 text-right`}>
                    Weekly installs
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => (
                  <tr
                    key={r.name}
                    className="border-b border-edge transition-colors last:border-b-0 hover:bg-surface-2"
                  >
                    {/* The rank is the ordering made visible. Without it a
                        leaderboard is a list you have to take on trust. */}
                    <td className={`${cell} pl-5 text-[11px] text-ink-3`}>
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <th scope="row" className={`${cell} truncate font-normal text-ink`}>
                      {r.name}
                    </th>
                    <td className={`${cell} text-ink-3 line-through decoration-ink-3/60`}>
                      {r.version_then}
                    </td>
                    <td className={cell}>
                      <span style={{ color: "var(--held)" }}>{r.version_now}</span>
                    </td>
                    <td className={`${cell} text-right`}>
                      <span
                        style={{
                          color: r.majors_since > 1 ? "var(--conflict)" : "var(--ink-2)",
                        }}
                      >
                        +{r.majors_since}
                      </span>
                    </td>
                    <td className={`${cell} text-ink-3`}>{month(r.bumped_at)}</td>
                    {/* Share bar beside the count, so the ranking reads as shape
                        as well as as digits. */}
                    <td className={`${cell} pr-5`}>
                      <span className="flex items-center gap-3">
                        <svg
                          aria-hidden
                          viewBox="0 0 100 6"
                          preserveAspectRatio="none"
                          className="h-1.5 min-w-[80px] flex-1"
                        >
                          <rect x="0" y="0" width="100" height="6" rx="1" fill="var(--surface-2)" />
                          <rect
                            x="0"
                            y="0"
                            width={(r.weekly_downloads / PEAK) * 100}
                            height="6"
                            rx="1"
                            fill="var(--ink-3)"
                            opacity="0.45"
                          />
                        </svg>
                        <span className="w-[46px] text-right text-ink-2">
                          {downloads(r.weekly_downloads)}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-edge bg-surface-2 px-5 py-4">
            <p className="max-w-[92ch] font-mono text-[11px] leading-[1.6] text-ink-3">
              {driftNote(month(drift.cutoff))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
