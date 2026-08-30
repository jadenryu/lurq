"use client";

import { useEffect, useRef, useState } from "react";

import { CopyCommandButton } from "@/components/site/copy-command-button";
import {
  fillFor,
  progress,
  stepAt,
  travelFor,
} from "@/lib/surface-progress";
import {
  SURFACES,
  SURFACES_HEAD,
  type TerminalLine,
} from "@/content/surfaces";

/**
 * The four ways in: a rail of surfaces on the left with a progress bar running
 * down it, the one you are on printed as a terminal on the right.
 *
 * The page never told anyone how to use lurq. The hero prints an install
 * command and the marquee promises "one command" without ever showing it, and
 * between them sat a demonstration, a tool grid, a provenance orbit and a drift
 * board: four sections of argument and no instructions. This is the
 * instructions, and it sits after the argument rather than before it.
 *
 * A rail rather than a row of tabs. The old version of this section had seven
 * pills across the top rotating on a 6s timer, which is two problems: a reader
 * who wants to compare two surfaces has to click and wait, and a reader who
 * wants to read one has it swapped out from under them. Vertical means all four
 * names and blurbs are on screen at once, so the list itself answers "how many
 * ways in are there" before anything is clicked.
 *
 * THE SCROLL IS THE TRANSPORT. The block pins to the middle of the screen and
 * the four surfaces are four positions on the way through the hold, so reading
 * down the section is what advances it. That is the same mechanism as the agent
 * session (see .room-session-pin and the note above it in tokens.css) and it is
 * deliberately the same: two sections on one page that both hold the screen
 * should hold it the same way.
 *
 * Keeping all four rows pinned rather than scrolling them past is the whole
 * reason the rail exists — a step that scrolls away takes the "there are four
 * of these" answer with it. So the rail holds still and the *bar* moves.
 *
 * Nothing rotates on its own, and nothing here is advance-only: this is a
 * position indicator, so scrolling back up runs it backwards. (The session
 * next door only ever advances, because a demonstration you have watched is not
 * a thing you rewind. A progress bar that will not go back down is just wrong.)
 *
 * WHEN THERE IS NO HOLD. Under reduce, with scripting off, on a narrow screen
 * or a short one, the stylesheet takes the track away and this reads its height
 * rather than re-deriving that decision — a track of zero means the rail goes
 * back to being four buttons you click, which is what it was. The bar then
 * reports which step you picked instead of where the scroll is.
 *
 * See content/surfaces.ts for what the panels are allowed to print.
 */

/** How long each character of the first line takes to land. */
const TYPE_MS = 17;

const STEPS = SURFACES.length;

const GLYPH: Partial<Record<TerminalLine["kind"], { char: string; tone: string }>> = {
  cmd: { char: "$", tone: "text-mark" },
  ok: { char: "✓", tone: "text-held" },
  next: { char: "→", tone: "text-ink-3" },
};

function Glyph({ kind }: { kind: TerminalLine["kind"] }) {
  const g = GLYPH[kind];
  if (!g) return null;
  // Decoration: the line's own text already says what happened, so a screen
  // reader gets nothing from "check mark" in front of "key validated".
  return (
    <span aria-hidden className={`pr-2 ${g.tone}`}>
      {g.char}
    </span>
  );
}

/**
 * The run. The first line types, the rest print once it has.
 *
 * A section whose whole argument is "this is a thing you type" cannot show a
 * static block of text and expect anyone to read it as a terminal. Everything
 * else on this page moves when it has something to say, and arriving at a step
 * is a reader asking to be shown a command, so the command gets typed.
 *
 * Keyed by index in the parent, so changing surface remounts this and the run
 * starts over. No timer teardown to coordinate, and no state here that has to be
 * reset on a prop change.
 */
function Terminal({ index, live }: { index: number; live: boolean }) {
  const surface = SURFACES[index];
  const head = surface.lines[0].text;
  const [typed, setTyped] = useState(0);

  // Nothing runs before the section is on screen: a run whose first frame
  // nobody saw is a run that may as well have been a screenshot. Under reduce
  // the whole line lands on the first tick instead of a character at a time,
  // which is the same code path with a bigger step rather than a second one.
  useEffect(() => {
    if (!live) return;
    const step = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? head.length
      : 1;
    let n = 0;
    const id = setInterval(() => {
      n = Math.min(head.length, n + step);
      setTyped(n);
      if (n >= head.length) clearInterval(id);
    }, TYPE_MS);
    return () => clearInterval(id);
  }, [head, live]);

  const done = typed >= head.length;

  return (
    <div
      data-done={done || undefined}
      className="room-surface-lines px-4 py-5 font-mono text-[12.5px] leading-[1.9] min-[720px]:px-6 min-[720px]:py-6"
    >
      {/* The typed line. The whole string is in the DOM from the first frame
          and the untyped tail is only transparent, which does three jobs at
          once: a screen reader reads the command rather than a growing
          fragment, the line cannot reflow as characters land, and with
          scripting off the tail simply shows (see tokens.css) instead of
          leaving an empty prompt. */}
      <p data-kind={surface.lines[0].kind}>
        <Glyph kind={surface.lines[0].kind} />
        {head.slice(0, typed)}
        {!done && <span aria-hidden className="room-caret" />}
        <span className="room-surface-untyped">{head.slice(typed)}</span>
      </p>

      {surface.lines.slice(1).map((line, i) => (
        <p
          key={line.text}
          style={{ ["--reveal-at" as string]: `${i * 90}ms` }}
          className="whitespace-pre-wrap break-words"
          data-kind={line.kind}
        >
          <Glyph kind={line.kind} />
          {line.text}
        </p>
      ))}

      {/* The prompt the run leaves behind. Without it the panel ends on its
          last line of output and reads as a transcript someone pasted. */}
      <p data-kind="cmd" data-tail>
        <Glyph kind="cmd" />
        <span aria-hidden className="room-caret" />
      </p>
    </div>
  );
}

export function SurfaceSwitch() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const surface = SURFACES[active];

  /** The track, the thing held on it, and the spacer that gives it its length.
   *  Progress is the distance the one has travelled inside the other, which
   *  needs no viewport arithmetic and is correct on any screen. */
  const pinRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<HTMLDivElement>(null);
  /** Carries --fill, which is the bar's height and nothing else. */
  const railRef = useRef<HTMLDivElement>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  /**
   * What is selected, readable synchronously. Two arrow presses inside one
   * frame both read the same render's `active` and the second one lands on the
   * square the first already left, so held arrow keys move one step and stop.
   * The ref is the current value rather than the last rendered one.
   */
  const activeRef = useRef(0);
  /** Whether the scroll is driving. A ref because no JSX depends on it — it
   *  only decides which of the two writers owns --fill. */
  const drivenRef = useRef(false);

  // The scroll driver. One layout read per frame, and the only thing it writes
  // on a normal frame is a custom property: --fill changes every frame and
  // `active` changes four times in the whole section, so re-rendering React on
  // scroll would be paying a render to move a 1px bar.
  useEffect(() => {
    const pin = pinRef.current;
    const stick = stickRef.current;
    const run = runRef.current;
    const rail = railRef.current;
    if (!pin || !stick || !run || !rail) return;

    let raf = 0;
    const read = () => {
      raf = 0;

      // The stylesheet decides whether there is a hold at all; this only reads
      // the answer. Zero means clicks are driving instead, so leave --fill to
      // the effect below and do not fight it for the attribute.
      const span = run.offsetHeight;
      if (span === 0) {
        if (drivenRef.current) {
          // Handing the bar back: a resize across the breakpoint, or a reduce
          // preference switched on mid-page. Whatever fraction the scroll left
          // behind is now meaningless, so redraw it as the step it is on rather
          // than leaving it parked between two stops.
          drivenRef.current = false;
          rail.removeAttribute("data-driven");
          rail.style.setProperty("--fill", String(fillFor(activeRef.current, STEPS)));
        }
        return;
      }
      if (!drivenRef.current) {
        drivenRef.current = true;
        rail.setAttribute("data-driven", "");
      }

      // How far the stuck element has travelled down its own track: 0 the frame
      // it locks, and it stops growing the frame the track runs out.
      const travel = stick.getBoundingClientRect().top - pin.getBoundingClientRect().top;
      const p = progress(travel, span);
      rail.style.setProperty("--fill", String(p));

      const next = stepAt(p, STEPS);
      if (next !== activeRef.current) {
        activeRef.current = next;
        setActive(next);
      }
    };

    // Coalesced to one read per frame. getBoundingClientRect in a raw scroll
    // handler is a layout read per event, and wheel events land faster than
    // frames do.
    const onScroll = () => {
      raf ||= requestAnimationFrame(read);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    read();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // The other writer. When there is no hold the bar is not reporting a scroll
  // position, it is reporting which of the four you picked, so it lands on the
  // step's own stop rather than at a quarter past it — hence STEPS - 1.
  useEffect(() => {
    if (drivenRef.current) return;
    railRef.current?.style.setProperty("--fill", String(fillFor(active, STEPS)));
  }, [active]);

  /** The first run waits for the section, the same way the tool grid does. */
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        // Also treat "already scrolled past" as reached — see the long note in
        // capability-grid.tsx. Scrolling by before hydration otherwise leaves
        // this panel permanently dead.
        const reached = entries.some(
          (e) => e.isIntersecting || e.boundingClientRect.top < 0,
        );
        if (reached) {
          setLive(true);
          io.disconnect();
        }
      },
      // Was `threshold: 0.35`, i.e. "35% of this panel on screen at once" — a
      // condition a phone viewport cannot satisfy for a panel taller than ~3x
      // the screen, so the callback never fired and the panel never went live.
      // Same defect as the tool grid; see the note there. Reveal-on-scroll wants
      // "any part of it is visible", which is threshold 0.
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /**
   * Picking a step.
   *
   * While the scroll is driving, setting state here would be overwritten by the
   * next frame's read, so a click has to move the thing that decides: the
   * scroll. Target the middle of the step's band rather than its edge, so a
   * click never lands a pixel from the boundary it would fall back across.
   *
   * Both distances come from the same two rects as the driver, so this needs to
   * know neither where the block sticks nor how long the track is.
   */
  const select = (to: number) => {
    const pin = pinRef.current;
    const stick = stickRef.current;
    const run = runRef.current;

    if (drivenRef.current && pin && stick && run) {
      const travel = stick.getBoundingClientRect().top - pin.getBoundingClientRect().top;
      const target = travelFor(to, STEPS, run.offsetHeight);
      window.scrollTo({
        top: window.scrollY + (target - travel),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      return;
    }

    activeRef.current = to;
    setActive(to);
  };

  /**
   * Roving tabindex: one stop for the whole rail, arrows move inside it. A
   * tablist where every tab is tabbable is four extra stops between the panel
   * and the rest of the page, which is the thing the pattern exists to avoid.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const last = STEPS - 1;
    const at = activeRef.current;
    const to =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? at === last
          ? 0
          : at + 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? at === 0
            ? last
            : at - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    e.preventDefault();
    select(to);
    // The rail is inside the held block and therefore already on screen, so
    // this only needs to move the focus ring. Without preventScroll the browser
    // would also scroll to reveal it and fight the smooth scroll above.
    tabs.current[to]?.focus({ preventScroll: true });
  };

  return (
    <section id="use" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      {/* The track. Its height is the held block plus the run below it, so the
          stuck element travels exactly one --pin-span before it lets go. The
          spacer is a real element and not padding: a sticky element is
          constrained by its parent's *content* box, so padding-bottom here
          would produce a taller section that never sticks at all. */}
      <div ref={pinRef} className="room-surface-pin mx-auto w-full max-w-[1180px]">
        <div ref={stickRef} className="room-surface-sticky">
          <h2
            className="max-w-[24ch] font-sans font-medium text-ink"
            style={{
              fontSize: "clamp(1.6rem, 3vw, 2.25rem)",
              lineHeight: 1.12,
              letterSpacing: "-0.028em",
            }}
          >
            {SURFACES_HEAD}
          </h2>

          <div className="mt-10 grid gap-6 min-[900px]:grid-cols-[0.85fr_1.15fr] min-[900px]:gap-10">
            {/* The rail, and the bar running down it. */}
            <div ref={railRef} className="room-surface-rail">
              {/* Drawn, not typed, and hidden: the bar says the same thing the
                  selected row already says out loud. */}
              <span aria-hidden className="room-surface-fill" />

              <div
                role="tablist"
                aria-orientation="vertical"
                aria-label="Ways to use lurq"
                onKeyDown={onKeyDown}
                className="flex flex-col gap-1"
              >
                {SURFACES.map((s, i) => {
                  const on = i === active;
                  return (
                    <button
                      key={s.id}
                      ref={(el) => {
                        tabs.current[i] = el;
                      }}
                      type="button"
                      role="tab"
                      id={`surface-tab-${s.id}`}
                      aria-selected={on}
                      aria-controls="surface-panel"
                      tabIndex={on ? 0 : -1}
                      onClick={() => select(i)}
                      data-on={on || undefined}
                      className="room-surface-tab"
                    >
                      <span aria-hidden className="room-surface-index">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-sans text-[15px] font-medium leading-[1.3] text-ink">
                        {s.name}
                      </span>
                      <span className="mt-1 block text-[13px] leading-[1.5] text-ink-2">
                        {s.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The panel. Not focusable: everything inside it is either static
                text or the copy button, so a tabpanel tab stop would be a stop on
                nothing. */}
            <div
              ref={panelRef}
              role="tabpanel"
              id="surface-panel"
              aria-labelledby={`surface-tab-${surface.id}`}
              className="min-w-0"
            >
              <div
                style={{ boxShadow: "0 24px 48px rgba(0,0,0,.35)" }}
                className="overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface"
              >
                {/* Title bar, same vocabulary as the session and drift panels. */}
                <div className="flex items-center gap-2.5 border-b border-edge bg-surface-2 px-4 py-3 min-[720px]:px-5">
                  <span aria-hidden className="room-surface-dots" />
                  <span
                    key={surface.id}
                    className="room-surface-swap ml-auto font-mono text-[11px] text-ink-3"
                  >
                    {surface.chrome}
                  </span>
                </div>

                {/* Held open to the tallest run, so changing surface never
                    resizes the panel and the copy button below it stays put. */}
                <div className="min-h-[236px] min-[900px]:min-h-[268px]">
                  <Terminal key={active} index={active} live={live} />
                </div>
              </div>

              {/* Above the prose, not below it. The detail runs to two lines for
                  two of these surfaces and three for the others, so a button
                  underneath it moved 22px every time the step changed, which is a
                  control shifting under the cursor that just clicked. The panel
                  holds its height, so anything directly beneath the panel holds
                  its position. */}
              <div className="mt-5">
                <CopyCommandButton
                  key={surface.id}
                  command={surface.command}
                  label={surface.command}
                  variant="outline"
                  className="max-w-full"
                />
              </div>

              <p
                key={surface.id}
                className="room-surface-swap mt-5 max-w-[62ch] text-[13.5px] leading-[1.65] text-ink-2"
              >
                {surface.detail}
              </p>
            </div>
          </div>
        </div>

        {/* The length of the hold. See .room-surface-pin in tokens.css. */}
        <div ref={runRef} aria-hidden className="room-surface-run" />
      </div>
    </section>
  );
}
