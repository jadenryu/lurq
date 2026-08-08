"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import drift from "@/content/generated/drift.json";
import { MODEL_CUTOFFS, type Vendor } from "@/content/model-cutoffs";
import { axisTicks, type AxisTick } from "@/lib/drift-axis";
import { Mark } from "@/components/site/wordmark";
import {
  DRIFT_BODY,
  DRIFT_HEAD_1,
  DRIFT_HEAD_2,
  DRIFT_PICKER_LABEL,
  SYNC_SUMMARY,
  driftStatShare,
  DRIFT_STAT_TRACKED,
  driftClaim,
  driftNote,
  driftStatDrifted,
} from "@/content/copy";

/**
 * What moved since the model was trained, as a surface rather than as a table.
 *
 * The section is two layers, because it makes two different kinds of statement.
 * In front is the claim: a model, the date its vendor says its knowledge stops,
 * and the share of the index that has broken since. Behind it is the evidence:
 * every row a package that was on one major at that date and is on a different
 * one now, ranked by weekly installs. The claim is the part a visitor reads; the
 * board is the part they check. Layering them says which is which without a
 * heading having to.
 *
 * Nothing readable sits under the overlap. The card crosses only the panel's
 * title bar, and at the width where it does the title bar's own label is hidden,
 * because the card has already said what is being looked at. Rows are never
 * covered: obscuring the data to make the data look good would be the one thing
 * this section cannot do.
 *
 * The picker is the point of the whole rebuild. Every date in MODEL_CUTOFFS is
 * transcribed from the vendor's own page and carries a link to it, so "your model
 * is N months behind" stops being our estimate and becomes theirs. The generator
 * runs one query per distinct cutoff, so switching models swaps in a genuinely
 * different board rather than re-filtering one.
 *
 * `use client` buys the picker, the sorting and the draw-in, and costs nothing at
 * the database: the data is still the build-time JSON, so this is a few KB in the
 * bundle and still zero queries per visitor.
 *
 * Sorting is four columns of `useState` and one `.sort()`. The reference
 * implementation for this was TanStack Table, which is a genuinely good library
 * and about 14kB gzipped to reorder eight rows that are known at build time.
 * Rank renumbers with the sort, because a leaderboard whose positions do not
 * follow its ordering is decoration.
 */

type Row = {
  name: string;
  version_then: string;
  version_now: string;
  majors_since: number;
  bumped_at: string;
  weekly_downloads: number;
};

type Bucket = { totals: { drifted: number; tracked: number }; rows: Row[] };

const BUCKETS = drift.buckets as Record<string, Bucket>;

/**
 * The right edge of every lane: the day the index was last synced.
 *
 * Measured against `generatedAt` rather than `Date.now()` on purpose. The right
 * edge has to be the same instant on the server and in the browser or the lanes
 * shift on hydration, and "as of the last sync" is the honest claim anyway. The
 * left edge is the selected model's cutoff, so it moves with the picker.
 */
const T1 = Date.parse(drift.generatedAt);
const AVG_MONTH = 2_629_746_000;

/** Where a date sits on a lane whose left edge is `t0`, as a CSS percentage. */
function at(iso: string, t0: number): string {
  const t = (Date.parse(iso) - t0) / Math.max(1, T1 - t0);
  return `${(Math.min(1, Math.max(0, t)) * 100).toFixed(2)}%`;
}

/** How long the model has been wrong about this package. */
function staleMonths(iso: string): number {
  return Math.max(0, Math.round((T1 - Date.parse(iso)) / AVG_MONTH));
}

/**
 * The same figure as a phrase, for the row's screen-reader line.
 *
 * The visible column says "1 mo", which is an abbreviation and is correctly
 * invariant. The spoken line was built as `${n} months` and read "wrong for 1
 * months" on every package whose major shipped inside the last six weeks, which
 * is four of the eight rows on the default board.
 */
function staleSpoken(iso: string): string {
  const n = staleMonths(iso);
  return `${n} ${n === 1 ? "month" : "months"}`;
}

function downloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// Both dates arrive as UTC (a date-only string parses as UTC midnight) and are
// formatted as UTC. Left to the local zone, a cutoff of 2026-05-01 renders as
// "apr 2026" anywhere west of Greenwich, which is a page about being a month
// behind getting the month wrong.
function month(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
    .toLowerCase();
}


/**
 * Rows are Geist, not Commit Mono.
 *
 * `tabular-nums` is what makes that safe. The argument for monospacing this
 * table was never the letterforms, it was the digits: `25.6.0` over `26.1.1`
 * over `382M` has to align on the column or the eye cannot compare down it.
 * Geist carries tabular figures, which buys exactly that alignment without
 * setting the package names in a face built for code editors. A proportional
 * name column also reads faster, which matters most for the one thing every
 * visitor scans for, which is whether they recognise anything on the list.
 */
const cell = "px-3 py-3.5 font-sans text-[13px] tabular-nums whitespace-nowrap";
/**
 * Headers are the page's sans at a size a person reads, not 10px mono capitals
 * on a 0.14em track. The cells below are monospaced because their contents are
 * literals — package names, semver strings, counts — and a column of those has
 * to align on the digit. A header is a sentence fragment in English and gets no
 * such benefit; setting it in the same face as the data was what made the whole
 * board read as one undifferentiated block of terminal output.
 *
 * --ink-2 rather than --ink-3, and 13px rather than 12. A header row dimmer and
 * smaller than the rows beneath it reads as quieter data; the job of this one is
 * to sit a layer above the data and say what each column is. Tracking is pulled
 * very slightly negative because Geist at 13px medium sets a touch loose for a
 * label, which is the opposite of the 0.14em track this replaced.
 *
 * No third font family. Inter was the obvious candidate and was measured
 * against Geist at this size: same neo-grotesque lineage, near-identical
 * texture, ~40kB for a difference nobody could name. Weight, size and value are
 * the levers that carry at 13px, and none of them cost a download.
 */
const head =
  "px-3 py-3 text-[13px] font-medium tracking-[-0.01em] text-ink-2 whitespace-nowrap";

/** The four columns worth ordering by. Version strings are not among them: "10.0.0" sorts before "9.0.0" as text and comparing them properly is a semver dependency for a control nobody asked for. */
type SortKey = "name" | "majors_since" | "bumped_at" | "weekly_downloads";
type Sort = { key: SortKey; desc: boolean };

/** The sort indicator. Its states live in .room-drift-caret, on the button. */
function Caret() {
  return (
    <svg
      aria-hidden
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      className="room-drift-caret shrink-0"
    >
      <path
        d="M2.5 4 5 6.5 7.5 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The lane column's header, which is the chart's time axis.
 *
 * It used to be the two edge labels with a hairline stretched between them, and
 * that hairline was the tell: it named no interval, aligned to nothing, and
 * carried no more information than the gap between the words would have. The
 * lanes under it were being read against four rules at 0/25/50/75%, which are
 * quarters of a span rather than dates, so on a nineteen-month board they fell
 * on nothing in particular and on a three-month board they fell on nothing at
 * all.
 *
 * So it is an axis: the cutoff at the left edge, the last sync at the right, and
 * the month boundaries between them marked and named. The geometry is shared
 * with the rows below on purpose — same flex row, same gap, same trailing 54px
 * column — so every tick lands exactly on the rule drawn through all eight
 * lanes, and a reader can put a straightedge down the column. The lane rules are
 * generated from these same positions (see --drift-grid), so the two cannot
 * drift apart.
 *
 * Still the sort control for the column. The caret sits in the trailing slot the
 * "N mo" figures occupy below, which is the only place on the axis that is not
 * already spoken for by a date.
 */
function AxisHead({
  from,
  ticks,
  sort,
  onSort,
}: {
  from: string;
  ticks: AxisTick[];
  sort: Sort;
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === "bumped_at";
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={head}
    >
      <button
        type="button"
        onClick={() => onSort("bumped_at")}
        data-active={active}
        data-dir={active && !sort.desc ? "asc" : "desc"}
        className={`room-drift-sort flex w-full items-center gap-3 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark ${
          active ? "text-ink" : ""
        }`}
        style={{ transitionDuration: "var(--dur-hover)" }}
      >
        {/* The control's name. The visible text is a run of dates, and a button
            called "may 2026 jun jul aug now" is a button nobody can act on. */}
        <span className="sr-only">Shipped</span>
        <span aria-hidden className="room-drift-axis">
          <span className="room-drift-axis-edge" style={{ left: 0 }}>
            {from}
          </span>
          <span className="room-drift-axis-edge" style={{ right: 0 }}>
            now
          </span>
          <span className="room-drift-axis-rule" />
          {ticks.map((t) => (
            <span key={t.at} className="room-drift-axis-tick" style={{ left: t.at }}>
              {t.label}
            </span>
          ))}
        </span>
        <span className="flex w-[54px] shrink-0 justify-end">
          <Caret />
        </span>
      </button>
    </th>
  );
}

/** A header that is also the control that orders by it. */
function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className = "",
}: {
  label: ReactNode;
  sortKey: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={`${head} ${align === "right" ? "text-right" : ""} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        data-active={active}
        data-dir={active && !sort.desc ? "asc" : "desc"}
        className={`room-drift-sort inline-flex w-full items-center gap-1.5 transition-[color] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark ${
          align === "right" ? "justify-end" : ""
        } ${active ? "text-ink" : ""}`}
        style={{ transitionDuration: "var(--dur-hover)" }}
      >
        {label}
        <Caret />
      </button>
    </th>
  );
}

/** One summary stat inside the claim card. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p
        className="font-sans font-medium leading-none text-ink"
        style={{ fontSize: "clamp(1.5rem, 2.2vw, 1.875rem)", letterSpacing: "-0.035em" }}
      >
        {value}
      </p>
      {/* The number above is monospaced by its own class; this is a clause of
          English and is set as one. */}
      <p className="mt-2 text-[12px] leading-[1.5] text-ink-3">{label}</p>
    </div>
  );
}

/**
 * The vendor marks, as the real glyphs already in public/logos rather than
 * anything redrawn here, painted through the same mask idiom the install strip
 * uses (.room-ide-mark). Masking is what lets one file be the right colour on
 * this ground: the Codex glyph ships black, which is invisible on --ground, and
 * the Gemini mark ships white, which throws away the one brand in the set that
 * is actually a gradient.
 *
 * Recognising your own model's logo is the whole job here. A visitor scanning
 * this section should find their model before they read a word of the copy.
 */
const VENDOR_MARK: Record<Vendor, { src: string; paint: string }> = {
  Anthropic: { src: "/logos/claude-code.svg", paint: "#d97757" },
  OpenAI: { src: "/logos/codex-mark.svg", paint: "var(--ink)" },
  Google: {
    src: "/logos/geminicli.svg",
    paint: "linear-gradient(135deg, #4285f4, #9b72cb 55%, #d96570)",
  },
};

/** "Claude Sonnet 4.6" becomes "Sonnet 4.6": the logo beside it already said Claude. */
function shortLabel(label: string): string {
  return label.replace(/^Claude /, "");
}

/**
 * This is a client component but Next still renders it once on the server,
 * where a layout effect cannot run and React says so in the console. The effect
 * below is pure measurement, so on the server there is genuinely nothing to do
 * and the swap silences a warning about a non-problem.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Re-rank, animated: rows slide from where they were to where the new ordering
 * puts them.
 *
 * FLIP, in the browser's own animation engine. The positions are read in a
 * layout effect after React has committed the new order but before paint, each
 * row is offset back to where it just was, and the offset is animated away. So
 * the DOM is only ever in the correct, sorted order — the movement is a paint
 * detail on top of it, which is why nothing here has to touch `rows`, the
 * keys, or the rank numbers.
 *
 * Sorting is the moment the board asks to be believed: click "Installs" and
 * eight rows silently become eight different rows, and a reader cannot tell a
 * re-order from a re-fetch. Watching row six climb to position two answers that
 * for free.
 *
 * `useLayoutEffect` and not `useEffect` on purpose. After paint the rows have
 * already been seen in their new places, and offsetting them then is a visible
 * jump backwards before the slide.
 *
 * ponytail: no library. This is the entire feature; react-flip-toolkit or
 * Framer's layout prop is 12-30kB to move eight table rows that are known at
 * build time. Reach for one if this table ever gains insertion, removal or
 * virtualisation, none of which are on the roadmap.
 */
function useRerank(deps: unknown[]): (node: HTMLTableSectionElement | null) => void {
  const body = useRef<HTMLTableSectionElement | null>(null);
  const wasAt = useRef(new Map<string, number>());

  useIsomorphicLayoutEffect(() => {
    const rows = body.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]");
    if (!rows) return;
    // Honoured here rather than in CSS: a Web Animation is not a transition and
    // the tokens.css reduced-motion block cannot reach it.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const row of rows) {
      const key = row.dataset.row!;
      const now = row.offsetTop;
      const before = wasAt.current.get(key);
      wasAt.current.set(key, now);
      // First measurement of this row, or it did not move. Nothing to play.
      if (before === undefined || before === now || still) continue;
      row.animate(
        [{ transform: `translateY(${before - now}px)` }, { transform: "none" }],
        // Long enough to follow a row across the board, short enough that a
        // second click does not queue behind the first.
        { duration: 420, easing: "cubic-bezier(.22,.61,.36,1)" },
      );
    }
     
  }, deps);

  // A callback ref, so a tbody remounting on a model change (it is keyed on the
  // cutoff) clears the remembered positions instead of animating the new
  // board's rows up from wherever the old board's rows happened to sit.
  //
  // Stable identity is load-bearing. An inline arrow is a new function every
  // render, which makes React detach and reattach the ref every render, which
  // would empty the map immediately before the layout effect reads it and no
  // row would ever be seen to move.
  return useCallback((node: HTMLTableSectionElement | null) => {
    wasAt.current.clear();
    body.current = node;
  }, []);
}

/**
 * How long each model holds the board before the picker moves on.
 *
 * The rows draw in over about a second, so anything under three leaves a reader
 * watching lanes arrive and never at rest. This is the beat after that: long
 * enough to read the sentence, take the percentage and recognise a package or
 * two, short enough that all six models are seen inside half a minute.
 */
const DWELL = 4800;

export function DriftBoard() {
  // Newest cutoff first, so the default is the most current model. Anyone whose
  // model is older sees a worse number, which is the honest direction to default.
  const [picked, setPicked] = useState(MODEL_CUTOFFS[0]!.label);
  // Weekly installs descending is the order the query already returns, so the
  // first paint matches the server HTML and nothing reshuffles on hydration.
  const [sort, setSort] = useState<Sort>({ key: "weekly_downloads", desc: true });
  const [shown, setShown] = useState(false);
  /** Whether the picker is still advancing itself. A click ends it for good. */
  const [cycling, setCycling] = useState(true);
  /** On screen. Nothing advances a board nobody is looking at. */
  const [live, setLive] = useState(false);
  /** Pointer or focus anywhere in the section: someone is reading it. */
  const [held, setHeld] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const model = MODEL_CUTOFFS.find((m) => m.label === picked) ?? MODEL_CUTOFFS[0]!;
  const bucket = BUCKETS[model.cutoff]!;
  const t0 = Date.parse(model.cutoff);
  const percent = Math.round((bucket.totals.drifted / bucket.totals.tracked) * 100);

  // The axis, and the rules the lanes are read against, out of one calculation.
  // Passing the tick positions to CSS as a list of single-pixel backgrounds is
  // what keeps them in step: the header cannot label a month the rows do not
  // rule, because there is only one set of numbers.
  //
  // Not memoised: nineteen iterations at the very worst, and no effect takes
  // either of them as a dependency, so a fresh array per render costs a string
  // comparison on one inline style.
  const ticks = axisTicks(t0, T1);
  const grid = ticks.length
    ? ticks
        .map((t) => `linear-gradient(var(--edge), var(--edge)) ${t.at} 0 / 1px 100% no-repeat`)
        .join(", ")
    : "none";

  const rows = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    return [...bucket.rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [sort, bucket]);

  const tbody = useRerank([rows]);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // No reduced-motion branch here on purpose: the media query in tokens.css
    // pins rows and bars to their finished state whatever `data-shown` says, so
    // someone who asked for less motion gets the plotted chart immediately
    // rather than an empty one.
    //
    // It keeps observing after the first crossing, which it did not used to.
    // `shown` is still a one-way latch — the lanes draw once, it is a
    // leaderboard and not a loop — but the picker below needs to know whether
    // the board is actually on screen, and a timer advancing a section nobody
    // is looking at burns a render every five seconds to change a chart in an
    // empty room.
    const io = new IntersectionObserver(
      ([entry]) => {
        const on = !!entry?.isIntersecting;
        setLive(on);
        if (on) setShown(true);
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /**
   * The picker advances itself until someone takes it.
   *
   * Six models are on that row and the default is the newest, which is the one
   * with the least to show: a visitor who never touches the chips reads the
   * mildest version of the argument and leaves. Cycling makes the section state
   * its own case — the same eight-row board rebuilt against a cutoff eighteen
   * months older, with the percentage climbing as it goes — and it advertises
   * that the chips are live, which a row of quiet pills does not.
   *
   * Three things stop it, and all three are the same rule: it runs only while
   * nobody is engaged with it. Off screen, under a pointer, or with focus
   * anywhere inside the section, it holds. Choosing a model ends it outright —
   * once a reader has said which model is theirs, moving the board off it is
   * taking the answer away.
   *
   * Reduced motion opts out entirely rather than cycling without the swap
   * animation. The objection there is not the fade, it is content that changes
   * on its own, and honouring the request means not doing that.
   */
  useEffect(() => {
    if (!cycling || !live || held) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setPicked((prev) => {
        const i = MODEL_CUTOFFS.findIndex((m) => m.label === prev);
        return MODEL_CUTOFFS[(i + 1) % MODEL_CUTOFFS.length]!.label;
      });
    }, DWELL);
    return () => clearInterval(id);
  }, [cycling, live, held]);

  function onSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, desc: !s.desc }
        : // A new column starts on the reading people expect: biggest first for
          // quantities, newest first for dates, A to Z for names.
          { key, desc: key !== "name" },
    );
  }

  return (
    <section id="drift" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="mx-auto max-w-[64ch] text-center">
          <h2
            className="font-sans font-medium text-ink"
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

        {/* Two layers: the claim in front, the evidence behind it.

            The hold is on the whole section rather than on the picker, because
            the thing that must not be pulled out from under a reader is the
            board, not the chips: someone half way down a column of versions
            when the model changes has lost their place. `data-cycle` is what
            the dwell indicator under the selected chip animates on, and it
            carries the three states apart so a pause is a pause and not a
            restart. */}
        <div
          data-cycle={cycling && live ? (held ? "hold" : "on") : undefined}
          style={{ ["--dwell" as string]: `${DWELL}ms` }}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocusCapture={() => setHeld(true)}
          onBlurCapture={() => setHeld(false)}
          className="relative mt-14"
        >
          {/* The bloom that puts the card in front of the panel rather than on
              it. Weather, not content. */}
          <div aria-hidden className="room-drift-bloom" />

          {/* FRONT: the claim. Deliberately short. A tall card here leaves a
              patch of empty ground to its right that the panel cannot rise into
              without covering rows, so the card earns its height back by putting
              the picker and the sentence it produces on one line. */}
          <div className="room-drift-claim rounded-xl border border-edge border-t-edge-lit bg-surface-2 p-5">
            {/* A radio group rather than a dropdown, because the logos are the
                hook and a dropdown hides them until you open it. Radios rather
                than buttons so arrow keys work and the group announces itself
                without any ARIA of our own. */}
            <fieldset className="min-w-0">
              <legend className="text-[13px] text-ink-3">{DRIFT_PICKER_LABEL}</legend>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {MODEL_CUTOFFS.map((m) => (
                  <label key={m.label} className="room-drift-chip" data-on={m.label === picked}>
                    <input
                      type="radio"
                      name="drift-model"
                      value={m.label}
                      checked={m.label === picked}
                      onChange={() => {
                        setPicked(m.label);
                        // Taken. The board belongs to the reader from here.
                        setCycling(false);
                      }}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className="room-vendor-mark"
                      style={{
                        ["--mark-src" as string]: `url(${VENDOR_MARK[m.vendor].src})`,
                        ["--mark-paint" as string]: VENDOR_MARK[m.vendor].paint,
                      }}
                    />
                    {shortLabel(m.label)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-edge pt-4">
              <p className="text-[15px] leading-[1.45] text-ink-2">
                {driftClaim(model.label)} <span className="text-ink">{month(model.cutoff)}</span>.
              </p>
              {/* The date is a transcription, so it links to the page it came
                  from. A cutoff nobody can check is the thing this section is
                  arguing against. */}
              <a
                href={model.source}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3 underline decoration-edge-lit underline-offset-[3px] transition-colors hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark"
                style={{ transitionDuration: "var(--dur-hover)" }}
              >
                {model.vendor}&rsquo;s published figure
                <svg aria-hidden width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M3 7 7 3M7 3H4M7 3v3"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </div>

            {/* The arithmetic, left to right as it runs: the share, the count it
                came from, the base it came out of. */}
            <div className="mt-4 grid grid-cols-3 gap-4">
              <Stat value={`${percent}%`} label={driftStatShare(month(model.cutoff))} />
              {/* Locale pinned, like every other formatted number on the page.
                  This is a client component, so an unpinned toLocaleString is
                  formatted once with the server's locale and again with the
                  visitor's: a de-DE browser renders 3.044 against the server's
                  3,044 and React throws out the subtree on a hydration
                  mismatch. */}
              <Stat
                value={bucket.totals.drifted.toLocaleString("en-US")}
                label={driftStatDrifted(month(model.cutoff))}
              />
              <Stat
                value={bucket.totals.tracked.toLocaleString("en-US")}
                label={DRIFT_STAT_TRACKED}
              />
            </div>
          </div>

          {/* BACK: the evidence. */}
          <div
            ref={panel}
            data-shown={shown}
            style={{ boxShadow: "0 24px 48px rgba(0,0,0,.35)" }}
            className="room-drift-panel overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface"
          >
            {/* Title bar. Its label is hidden at the width where the claim card
                covers it, since the card has already named the thing. */}
            <div className="flex items-center gap-3 border-b border-edge bg-surface-2 px-4 py-3 min-[720px]:px-5">
              <span className="room-drift-title flex items-center gap-3">
                <span className="text-ink">
                  <Mark size={14} />
                </span>
                <span className="font-mono text-[12px] text-ink">version drift</span>
              </span>
              {/* The size of the last sync, not just its date. "synced 6 aug"
                  is a timestamp and says nothing about whether the sync did
                  anything; a reader checking how live this board is wants the
                  volume. Both halves come out of the same record in stats.json,
                  so the count and the day it belongs to cannot drift apart. */}
              <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-ink-3">
                <span aria-hidden className="room-wire-beat size-1.5 rounded-full" />
                {SYNC_SUMMARY}
              </span>
            </div>

            {/* The rows. Scrolls sideways rather than dropping columns: a board
                missing a column is a board you cannot check.

                `relative` is load-bearing, not decoration. Tailwind's `sr-only` is
                position:absolute, so every screen-reader span in this table resolves
                its containing block to the nearest positioned ancestor. Without a
                positioned scroller that was the root layout wrapper, three levels
                up and outside the clip, so the spans planted themselves at the
                table's full 880px x-offset and dragged the whole document 191px
                sideways at 390px wide. The page scrolled into empty black and the
                board looked like it scrolled forever. Same reason
                components/ui/table.tsx pairs `relative` with `overflow-x-auto`. */}
            <div className="room-drift-scroll relative overflow-x-auto">
              {/* table-fixed plus an explicit colgroup, so the columns land in the
                  same place whatever the day's data is. Left to auto layout the
                  widths follow the longest package name, which is why the board
                  looked hand-placed differently on every refresh. */}
              <table
                // Inherited by every lane's ::before, which is the rule set the
                // axis above labels. One declaration for eight rows.
                style={{ ["--drift-grid" as string]: grid }}
                className="w-full min-w-[880px] table-fixed border-collapse text-left"
              >
                <caption className="sr-only">
                  Packages that changed major version since {model.label}&rsquo;s knowledge cutoff
                  of {month(model.cutoff)}, by weekly installs
                </caption>
                {/* Every column is fixed except the lane, so all the slack goes to
                    the axis. It is the chart; everything else is its labels. */}
                <colgroup>
                  <col className="w-[56px]" />
                  {/* Narrower before the board fits, so the two version columns
                      (the whole argument) are the first thing scrolled to. */}
                  <col className="w-[172px] min-[928px]:w-[228px]" />
                  <col className="w-[124px]" />
                  <col className="w-[124px]" />
                  <col className="w-[76px]" />
                  <col />
                  <col className="w-[92px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-edge bg-surface-2/40">
                    <th scope="col" className={`${head} pl-5`}>
                      <span className="sr-only">Rank</span>
                    </th>
                    <SortHead label="Package" sortKey="name" sort={sort} onSort={onSort} />
                    <th scope="col" className={head}>
                      Model believes
                    </th>
                    <th scope="col" className={head}>
                      Actually on
                    </th>
                    <SortHead
                      label="Majors"
                      sortKey="majors_since"
                      sort={sort}
                      onSort={onSort}
                      align="right"
                    />
                    {/* The header is the axis: see AxisHead. */}
                    <AxisHead
                      from={month(model.cutoff)}
                      ticks={ticks}
                      sort={sort}
                      onSort={onSort}
                    />
                    <SortHead
                      label="Installs"
                      sortKey="weekly_downloads"
                      sort={sort}
                      onSort={onSort}
                      align="right"
                      className="pr-5"
                    />
                  </tr>
                </thead>
                {/* Keyed on the cutoff so switching models fades the new board in.
                    A table whose contents change with no acknowledgement reads as
                    a glitch. */}
                <tbody key={model.cutoff} ref={tbody} className="room-drift-swap">
                  {rows.map((r, i) => (
                    <tr
                      key={r.name}
                      // The identity useRerank tracks a row by across a sort.
                      // The React key cannot be read back off the DOM.
                      data-row={r.name}
                      // Each row carries its own place in the ladder, so the
                      // schedule reads in source order instead of hiding in CSS.
                      style={{ ["--row-at" as string]: `${i * 40}ms` }}
                      className="room-drift-row border-b border-edge last:border-b-0 hover:bg-surface-2"
                    >
                      {/* The rank is the ordering made visible. Without it a
                          leaderboard is a list you have to take on trust. */}
                      <td className={`${cell} room-drift-rank pl-5 text-[11px] text-ink-3`}>
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      {/* The name goes to the registry. Every row here is a
                          claim about a published package, and the place that
                          settles it is the package's own npm page: the majors
                          it has shipped and the day each one landed are on it.
                          A board that says "you are three majors behind on
                          react" and gives you no way to go and look is asking
                          to be taken on trust, which is the posture this whole
                          section is arguing against.

                          aria-label rather than a visible "on npm" or an arrow
                          glyph per row: eight of either turns the column every
                          visitor scans first into a column of decoration. The
                          name is contained in the label, so the spoken name and
                          the visible one still match. */}
                      <th scope="row" className={`${cell} font-normal text-ink`}>
                        <a
                          href={`https://www.npmjs.com/package/${r.name}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${r.name} on npm`}
                          className="room-drift-pkg block truncate"
                        >
                          {r.name}
                        </a>
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
                      {/* The lane. One shared axis, so the rows are comparable to
                          each other and not just to themselves: green while the
                          model's answer still held, orange from the moment the new
                          major shipped, a marker on the day it did, and the months
                          it has been wrong since. The verdict tokens are doing
                          exactly the job they were reserved for. */}
                      <td className={`${cell} px-3`}>
                        <span className="flex items-center gap-3">
                          <span
                            className="room-drift-track"
                            style={{ ["--at" as string]: at(r.bumped_at, t0) }}
                          >
                            <i aria-hidden className="room-drift-held" />
                            <i aria-hidden className="room-drift-wrong" />
                            <i
                              aria-hidden
                              className="room-drift-dot"
                              data-multi={r.majors_since > 1}
                            />
                          </span>
                          <span className="w-[54px] shrink-0 text-right text-[12px] text-ink-3">
                            {staleMonths(r.bumped_at)} mo
                          </span>
                        </span>
                        <span className="sr-only">
                          shipped {month(r.bumped_at)}, wrong for {staleSpoken(r.bumped_at)}
                        </span>
                      </td>
                      <td className={`${cell} pr-5 text-right text-ink-2`}>
                        {downloads(r.weekly_downloads)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* No measure cap on the note. It is one short paragraph of 11px
                mono across a panel this wide, and capping it at 92ch left the
                right half of the footer empty, which read as a rendering fault
                rather than as typography. */}
            <div className="border-t border-edge bg-surface-2 px-5 py-4">
              <p className="text-[12px] leading-[1.6] text-ink-3">
                {driftNote(model.label, model.vendor, month(model.cutoff))}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
