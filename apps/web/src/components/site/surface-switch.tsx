"use client";

import { useEffect, useRef, useState } from "react";

import { CopyCommandButton } from "@/components/site/copy-command-button";
import {
  SURFACES,
  SURFACES_HEAD,
  type TerminalLine,
} from "@/content/surfaces";

/**
 * The four ways in: a rail of surfaces on the left, the one you picked printed
 * as a terminal on the right.
 *
 * The page never told anyone how to use lurq. The hero prints an install
 * command and the marquee promises "one command" without ever showing it, and
 * between them sat a demonstration, a tool grid, a provenance orbit and a drift
 * board — four sections of argument and no instructions. This is the
 * instructions, and it sits after the argument rather than before it.
 *
 * A rail rather than a row of tabs. The old version of this section had seven
 * pills across the top rotating on a 6s timer, which is two problems: a reader
 * who wants to compare two surfaces has to click and wait, and a reader who
 * wants to read one has it swapped out from under them. Vertical means all four
 * names and blurbs are on screen at once, so the list itself answers "how many
 * ways in are there" before anything is clicked, and the click is only for the
 * detail.
 *
 * Nothing rotates on its own. See content/surfaces.ts for what the panels are
 * allowed to print.
 */

/** How long each character of the first line takes to land. */
const TYPE_MS = 17;

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
 * else on this page moves when it has something to say, and a click here is a
 * reader asking to be shown a command, so the command gets typed.
 *
 * Keyed by index in the parent, so switching surfaces remounts this and the run
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

  /** The first run waits for the section, the same way the tool grid does. */
  const panelRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLive(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /**
   * What is selected, readable synchronously. Two arrow presses inside one
   * frame both read the same render's `active` and the second one lands on the
   * square the first already left, so held arrow keys move one step and stop.
   * The ref is the current value rather than the last rendered one.
   */
  const activeRef = useRef(0);
  const select = (to: number) => {
    activeRef.current = to;
    setActive(to);
  };

  /**
   * Roving tabindex: one stop for the whole rail, arrows move inside it. A
   * tablist where every tab is tabbable is four extra stops between the panel
   * and the rest of the page, which is the thing the pattern exists to avoid.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const last = SURFACES.length - 1;
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
    tabs.current[to]?.focus();
  };

  return (
    <section id="use" className="w-full px-4 py-24 min-[768px]:px-6 min-[900px]:py-32">
      <div className="mx-auto w-full max-w-[1180px]">
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
          {/* The rail. */}
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Ways to use lurq"
            onKeyDown={onKeyDown}
            className="room-surface-rail flex flex-col gap-1"
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
                <span className="ml-auto font-mono text-[11px] text-ink-3">
                  {surface.chrome}
                </span>
              </div>

              {/* Held open to the tallest run, so switching surfaces never
                  resizes the panel and the copy button below it stays put. */}
              <div className="min-h-[236px] min-[900px]:min-h-[268px]">
                <Terminal key={active} index={active} live={live} />
              </div>
            </div>

            {/* Above the prose, not below it. The detail runs to two lines for
                two of these surfaces and three for the others, so a button
                underneath it moved 22px every time the tab changed, which is a
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

            <p className="mt-5 max-w-[62ch] text-[13.5px] leading-[1.65] text-ink-2">
              {surface.detail}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
