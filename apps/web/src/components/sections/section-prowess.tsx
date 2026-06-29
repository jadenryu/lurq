"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { capabilities, type ClipLine } from "@/content/capabilities";
import { cn } from "@/lib/utils";

// Typing cadence + how long a finished clip rests before advancing. Swaps are
// driven by the clip finishing (never a fixed timer), so a tab only changes
// once its terminal animation has fully played out.
const CHAR_MS = 32;
const LINE_PAUSE_MS = 420;
const HOLD_MS = 2400;
const REDUCED_HOLD_MS = 2600;

// Terminal palette: kept theme-independent so the clip always renders dark,
// like the real CLI, regardless of the site's light/dark mode.
const term = {
  bg: "#09090c",
  border: "rgba(255,255,255,0.10)",
  text: "#d6d8e0",
  dim: "#7e8298",
  prompt: "#8b9bf5",
  ok: "#79d2a6",
  bad: "#e0796f",
  accent: "#b9a4f0",
};

function lineColor(tone: ClipLine["tone"]) {
  switch (tone) {
    case "prompt":
      return term.text;
    case "dim":
      return term.dim;
    case "ok":
      return term.ok;
    case "bad":
      return term.bad;
    case "accent":
      return term.accent;
    default:
      return term.text;
  }
}

function Clip({ index, onDone }: { index: number; onDone: () => void }) {
  const reduce = useReducedMotion();
  const cap = capabilities[index];

  return (
    <div className="relative">
      {/* ambient glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10 -z-10 opacity-70 blur-2xl"
        style={{
          background:
            "radial-gradient(60% 55% at 60% 50%, rgba(139,123,240,0.22), transparent 70%)",
        }}
      />

      <div
        className="relative flex min-h-[22rem] flex-col overflow-hidden rounded-[var(--radius-xl)] border p-6 shadow-2xl shadow-black/50 md:min-h-[30rem] md:p-9"
        style={{ backgroundColor: term.bg, borderColor: term.border }}
      >
        <span
          className="font-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: term.dim }}
        >
          lurq · {cap.id}
        </span>

        {/* key on cap.id so switching tabs remounts and re-types the clip */}
        <div className="flex flex-1 items-start pt-3">
          <Typewriter
            key={cap.id}
            lines={cap.lines}
            reduce={!!reduce}
            onDone={onDone}
          />
        </div>
      </div>
    </div>
  );
}

// Types the clip out the way an LLM streams: character by character, line by
// line, with a steady cursor while typing that starts blinking once finished.
// Calls onDone once the whole clip has finished so the parent can advance.
function Typewriter({
  lines,
  reduce,
  onDone,
}: {
  lines: ClipLine[];
  reduce: boolean;
  onDone: () => void;
}) {
  const [pos, setPos] = useState(
    reduce ? { line: lines.length, char: 0 } : { line: 0, char: 0 },
  );

  // keep the latest onDone without re-running the typing effect
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    // reduced motion shows everything at once, then still hands off after a rest
    if (reduce) {
      const id = setTimeout(() => onDoneRef.current(), REDUCED_HOLD_MS);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = (line: number, char: number) => {
      if (cancelled || line >= lines.length) return;
      const len = lines[line].text.length;
      if (char < len) {
        const next = char + 1;
        setPos({ line, char: next });
        // a touch of easing in the cadence: punctuation/space gets a longer beat
        const ch = lines[line].text[char];
        const delay =
          ch === " " ? CHAR_MS * 1.6 : /[.,:·→]/.test(ch) ? CHAR_MS * 3 : CHAR_MS;
        timer = setTimeout(() => tick(line, next), delay);
      } else {
        timer = setTimeout(() => {
          if (cancelled) return;
          const nextLine = line + 1;
          setPos({ line: nextLine, char: 0 });
          if (nextLine >= lines.length) onDoneRef.current();
          else tick(nextLine, 0);
        }, LINE_PAUSE_MS);
      }
    };

    // schedule the first character asynchronously so we never call setState
    // synchronously inside the effect body
    timer = setTimeout(() => tick(0, 0), CHAR_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lines, reduce]);

  const finished = pos.line >= lines.length;

  return (
    <div className="w-full space-y-2.5 font-mono text-sm leading-relaxed md:text-[15px]">
      {lines.map((line, i) => {
        if (i > pos.line) return null;
        const isCurrent = i === pos.line && !finished;
        const shown = isCurrent ? line.text.slice(0, pos.char) : line.text;
        const isPrompt = line.tone === "prompt";
        const showCursor = isCurrent || (finished && i === lines.length - 1);
        return (
          <p key={i} className="flex gap-2">
            {isPrompt ? <span style={{ color: term.prompt }}>$</span> : null}
            <span style={{ color: lineColor(line.tone) }}>{shown}</span>
            {showCursor ? (
              <span
                className={cn(
                  "inline-block h-4 w-[7px] self-center",
                  finished && "animate-pulse",
                )}
                style={{ backgroundColor: term.text }}
              />
            ) : null}
          </p>
        );
      })}
    </div>
  );
}

function TabItem({
  cap,
  active,
  onSelect,
}: {
  cap: (typeof capabilities)[number];
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = cap.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group relative w-full overflow-hidden rounded-[var(--radius-lg)] px-6 py-6 text-left transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
        active
          ? "border border-border bg-gradient-to-b from-secondary/80 to-secondary/30 shadow-xl shadow-black/20"
          : "border border-transparent hover:bg-secondary/20",
      )}
    >
      {/* soft top highlight on the active card, like the reference */}
      {active ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent"
        />
      ) : null}
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
            active
              ? "border-border bg-background text-foreground"
              : "border-border bg-secondary/60 text-muted-foreground group-hover:text-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3
            className={cn(
              "text-xl font-medium transition-colors duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
              active ? "text-foreground" : "text-foreground/70",
            )}
          >
            {cap.title}
          </h3>
          <p
            className={cn(
              "mt-2 text-base leading-relaxed transition-colors duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
              active ? "text-muted-foreground" : "text-muted-foreground/60",
            )}
          >
            {cap.body}
          </p>
        </div>
      </div>
    </button>
  );
}

export function SectionProwess() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  // index of the clip that has finished typing; lags `active` until the current
  // clip completes, so a tab only advances after its animation plays out
  const [doneIndex, setDoneIndex] = useState<number | null>(null);

  useEffect(() => {
    if (paused || doneIndex !== active) return;
    const id = setTimeout(() => {
      setActive((i) => (i + 1) % capabilities.length);
    }, HOLD_MS);
    return () => clearTimeout(id);
  }, [doneIndex, active, paused]);

  return (
    <section className="relative overflow-hidden border-t border-border py-24 md:py-32">
      <Container>
        <Reveal>
          <div className="mx-auto max-w-none text-center">
            <h2 className="text-4xl font-semibold leading-[1.04] tracking-tight md:text-5xl lg:whitespace-nowrap">
              Built to outperform the alternatives.
            </h2>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div
            className="mt-14 grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            {/* left: category list */}
            <div className="flex flex-col gap-1.5">
              {capabilities.map((cap, i) => (
                <TabItem
                  key={cap.id}
                  cap={cap}
                  active={i === active}
                  onSelect={() => setActive(i)}
                />
              ))}
            </div>

            {/* right: terminal clip, reports completion so the next tab only
                swaps in once typing has finished */}
            <Clip index={active} onDone={() => setDoneIndex(active)} />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
