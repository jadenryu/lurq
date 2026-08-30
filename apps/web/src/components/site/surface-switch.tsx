"use client";

import { useEffect, useRef, useState } from "react";

import { CopyCommandButton } from "@/components/site/copy-command-button";
import { checkpointAt } from "@/lib/surface-progress";
import {
  SURFACES,
  SURFACES_HEAD,
  type Surface,
  type TerminalLine,
} from "@/content/surfaces";

/**
 * The four ways in, one after another, with a bar down the side saying which
 * one you are on.
 *
 * The page never told anyone how to use lurq. The hero prints an install
 * command and the marquee promises "one command" without ever showing it, and
 * between them sat a demonstration, a tool grid, a provenance orbit and a drift
 * board: four sections of argument and no instructions. This is the
 * instructions, and it sits after the argument rather than before it.
 *
 * ALL FOUR ARE ON THE PAGE. They were tabs once, then a single panel that
 * swapped its contents as you scrolled through a hold. Both versions had the
 * same defect: three of the four ways in were things you had to *ask* to see,
 * and a reader who scrolls — which is every reader — saw one. Four entry points
 * that need four interactions to read are three entry points nobody knows
 * about. So each one is now its own block with its own run, and scrolling is
 * the only thing anybody has to do.
 *
 * The rail is what the swap was hiding: a sticky column of four checkpoints
 * with a bar filling down it, so "how many ways in are there" is answered at a
 * glance and stays answered while you read past the second one. It is a table
 * of contents, and it is built as one — plain anchors to the block ids, so it
 * deep-links, it is keyboard-navigable for free, and it works with no script at
 * all.
 *
 * THE BAR LANDS ON ITS STOPS. Fill is interpolated between the blocks' own
 * offsets rather than taken from a scroll fraction, so the head sits exactly on
 * checkpoint n at the moment block n reaches the reading line. A bar driven by
 * raw scroll drifts off its own dots, and a progress head that does not touch
 * the stop it is pointing at is worse than no bar. See lib/surface-progress.ts.
 *
 * Each run types itself when its own block arrives, and only once: a section
 * that re-types every time it passes the fold is a section you cannot scroll
 * back through to re-read.
 *
 * See content/surfaces.ts for what the panels are allowed to print.
 */

/** How long each character of the first line takes to land. */
const TYPE_MS = 17;

/** Where down the viewport a block counts as "the one being read". */
const ANCHOR = 0.42;

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
 * else on this page moves when it has something to say, and a run arriving on
 * screen is the moment this one has something to say.
 */
function Terminal({ surface, live }: { surface: Surface; live: boolean }) {
  const head = surface.lines[0].text;
  const [typed, setTyped] = useState(0);

  // Nothing runs before its block is on screen: a run whose first frame nobody
  // saw is a run that may as well have been a screenshot. Under reduce the whole
  // line lands on the first tick instead of a character at a time, which is the
  // same code path with a bigger step rather than a second one.
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

/** One entry point: what it is, the run, the command, and why you'd want it. */
function Block({
  surface,
  index,
  live,
  on,
  innerRef,
}: {
  surface: Surface;
  index: number;
  live: boolean;
  on: boolean;
  innerRef: (el: HTMLElement | null) => void;
}) {
  return (
    <article
      ref={innerRef}
      id={`use-${surface.id}`}
      data-on={on || undefined}
      className="room-surface-block"
      aria-labelledby={`use-${surface.id}-title`}
    >
      <p aria-hidden className="room-surface-index">
        {String(index + 1).padStart(2, "0")}
      </p>
      <h3
        id={`use-${surface.id}-title`}
        className="font-sans text-[19px] font-medium leading-[1.25] tracking-[-0.018em] text-ink min-[720px]:text-[21px]"
      >
        {surface.name}
      </h3>
      <p className="mt-1.5 text-[14px] leading-[1.5] text-ink-2">{surface.blurb}</p>

      <div
        style={{ boxShadow: "0 24px 48px rgba(0,0,0,.35)" }}
        className="mt-5 overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface"
      >
        {/* Title bar, same vocabulary as the session and drift panels. */}
        <div className="flex items-center gap-2.5 border-b border-edge bg-surface-2 px-4 py-3 min-[720px]:px-5">
          <span aria-hidden className="room-surface-dots" />
          <span className="ml-auto font-mono text-[11px] text-ink-3">
            {surface.chrome}
          </span>
        </div>
        <Terminal surface={surface} live={live} />
      </div>

      {/* Above the prose, not below it: the command is the thing you came for,
          and the paragraph is why you'd want it. */}
      <div className="mt-5">
        <CopyCommandButton
          command={surface.command}
          label={surface.command}
          variant="outline"
          className="max-w-full"
        />
      </div>

      <p className="mt-5 max-w-[62ch] text-[13.5px] leading-[1.65] text-ink-2">
        {surface.detail}
      </p>
    </article>
  );
}

export function SurfaceSwitch() {
  const [at, setAt] = useState(0);
  /** Which runs have played. Never unset: see the note at the top. */
  const [played, setPlayed] = useState<boolean[]>(() => SURFACES.map(() => false));

  const blocks = useRef<(HTMLElement | null)[]>([]);
  /** Carries --fill, which is the bar's height and nothing else. */
  const railRef = useRef<HTMLDivElement>(null);
  const atRef = useRef(0);

  // Which block is being read, and where the bar sits. One layout read per
  // frame, and on a normal frame the only thing written is a custom property:
  // --fill changes every frame and `at` changes four times in the whole section,
  // so re-rendering React on scroll would be paying a render to move a 1px bar.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    let raf = 0;
    const read = () => {
      raf = 0;
      const els = blocks.current;
      if (els.some((el) => !el)) return;

      const tops = els.map((el) => el!.getBoundingClientRect().top);
      const { index, fill } = checkpointAt(tops, window.innerHeight * ANCHOR);

      rail.style.setProperty("--fill", String(fill));
      if (index !== atRef.current) {
        atRef.current = index;
        setAt(index);
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

  // Each run waits for its own block. One observer for all four, and a block is
  // dropped from it the moment it plays: an observer still watching a run that
  // has finished is work done on every scroll for an answer that cannot change.
  useEffect(() => {
    const els = blocks.current.filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        const arrived: number[] = [];
        for (const e of entries) {
          // "Already scrolled past" counts as arrived — see the long note in
          // capability-grid.tsx. Landing below this section on a deep link
          // otherwise leaves every run above it permanently unplayed.
          if (!e.isIntersecting && e.boundingClientRect.top >= 0) continue;
          const i = els.indexOf(e.target as HTMLElement);
          if (i >= 0) {
            arrived.push(i);
            io.unobserve(e.target);
          }
        }
        if (arrived.length === 0) return;
        setPlayed((prev) => {
          const next = [...prev];
          for (const i of arrived) next[i] = true;
          return next;
        });
      },
      // Threshold 0: "any part of it is visible". A fraction cannot be satisfied
      // by a block taller than the viewport, which is the defect that left the
      // old panel dead on phones — see the note in capability-grid.tsx.
      { threshold: 0, rootMargin: "0px 0px -15% 0px" },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

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

        <div className="mt-12 grid gap-10 min-[900px]:grid-cols-[0.58fr_1.42fr] min-[900px]:gap-14">
          {/* The rail: a table of contents that happens to draw where you are.
              Anchors rather than buttons, so it deep-links, takes focus in
              order, and still navigates with no script running. */}
          <nav aria-label="Ways to use lurq" className="room-surface-nav">
            <div ref={railRef} className="room-surface-rail">
              {/* The bar says the same thing the current row already says out
                  loud, so it is drawn and hidden rather than announced. */}
              <span aria-hidden className="room-surface-fill" />

              <ol className="flex flex-col gap-1">
                {SURFACES.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#use-${s.id}`}
                      data-on={i === at || undefined}
                      aria-current={i === at ? "true" : undefined}
                      className="room-surface-stop"
                    >
                      <span aria-hidden className="room-surface-index">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-sans text-[14.5px] font-medium leading-[1.3] text-ink">
                        {s.name}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          <div className="room-surface-blocks min-w-0">
            {SURFACES.map((s, i) => (
              <Block
                key={s.id}
                surface={s}
                index={i}
                live={played[i]}
                on={i === at}
                innerRef={(el) => {
                  blocks.current[i] = el;
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
