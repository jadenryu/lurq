"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { SectionLabel } from "@/components/common/section-label";
import { contrastCases, type ContrastCase } from "@/content/contrast";
import { cn } from "@/lib/utils";

const ROTATE_MS = 5500;

// Lifted charcoal frame + restrained terminal syntax colors (hue only inside
// the mock; page chrome stays monochrome).
const cc = {
  bg: "#14161a",
  border: "rgba(255,255,255,0.10)",
  text: "#e4e4e4",
  dim: "#8a8a8a",
  prompt: "#9db4ff", // soft blue · user prompt
  ok: "#7dcea0", // soft green · success / tool hit
  bad: "#e08b7a", // soft coral · failure flag
  accent: "#c4b5fd", // soft violet · package / emphasis
};

function Mascot() {
  // pixel-art mark — warm grey so it sits with the mono chrome, not neon
  return (
    <svg
      viewBox="0 0 16 9"
      width="34"
      height="19"
      shapeRendering="crispEdges"
      aria-hidden
      className="shrink-0"
    >
      <g fill="#c9a88a">
        <rect x="3" y="0" width="10" height="2" />
        <rect x="1" y="2" width="14" height="4" />
        <rect x="2" y="6" width="12" height="1" />
        <rect x="2" y="7" width="2" height="1" />
        <rect x="6" y="7" width="2" height="1" />
        <rect x="10" y="7" width="2" height="1" />
      </g>
      <g fill={cc.bg}>
        <rect x="4" y="2" width="1" height="2" />
        <rect x="6" y="2" width="1" height="2" />
      </g>
    </svg>
  );
}

function TerminalHeader() {
  return (
    <div className="flex items-start gap-3 px-5 pt-5">
      <Mascot />
      <div className="font-mono text-[12px] leading-snug">
        <p>
          <span className="font-semibold" style={{ color: cc.prompt }}>
            Claude Code
          </span>{" "}
          <span style={{ color: cc.dim }}>v2.1.195</span>
        </p>
        <p style={{ color: cc.dim }}>Opus 4.8 (1M context) · Claude Max</p>
        <p style={{ color: cc.dim }}>~/Desktop/parent/lurq</p>
      </div>
    </div>
  );
}

function TerminalInputBar({ placeholder }: { placeholder: string }) {
  return (
    <div
      className="mt-auto border-t px-5 pb-4 pt-3 font-mono text-[12px]"
      style={{ borderColor: cc.border }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: cc.dim }}>›</span>
        <span
          className="inline-block h-3.5 w-[7px] animate-pulse"
          style={{ backgroundColor: cc.text }}
        />
        <span style={{ color: cc.dim }}>{placeholder}</span>
      </div>
      <p className="mt-2.5 text-[11px]" style={{ color: cc.dim }}>
        ? for shortcuts · ← for agents
      </p>
    </div>
  );
}

function PromptLine({ prompt }: { prompt: string }) {
  return (
    <p className="flex gap-2">
      <span style={{ color: cc.prompt }}>{">"}</span>
      <span style={{ color: cc.text }}>{prompt}</span>
    </p>
  );
}

function WithoutBody({ c }: { c: ContrastCase }) {
  return (
    <div className="space-y-3 font-mono text-[13px] leading-relaxed">
      <PromptLine prompt={c.prompt} />
      <div className="space-y-1" style={{ color: cc.text }}>
        {c.without.reply.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <p className="flex gap-2 pt-1" style={{ color: cc.bad }}>
        <span>✗</span>
        <span>{c.without.flag}</span>
      </p>
    </div>
  );
}

function WithBody({ c }: { c: ContrastCase }) {
  return (
    <div className="space-y-3 font-mono text-[13px] leading-relaxed">
      <PromptLine prompt={c.prompt} />

      {/* lurq tool call, Claude Code MCP style */}
      <div className="space-y-1">
        <p className="flex gap-2">
          <span style={{ color: cc.ok }}>⏺</span>
          <span style={{ color: cc.text }}>{c.with.toolCall}</span>
        </p>
        <div className="pl-[18px]" style={{ color: cc.dim }}>
          <p className="flex gap-2">
            <span>⎿</span>
            <span>
              <span style={{ color: cc.accent }}>{c.with.pkg}</span> ·{" "}
              {c.with.score}
            </span>
          </p>
          <div className="mt-1 space-y-0.5 pl-5">
            {c.with.evidence.map((e) => (
              <p key={e.label} className="flex justify-between gap-6">
                <span>{e.label}</span>
                <span style={{ color: cc.text }}>{e.value}</span>
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1 pt-1" style={{ color: cc.text }}>
        {c.with.reply.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function Terminal({
  label,
  tone,
  placeholder,
  bodyKey,
  children,
}: {
  label: string;
  tone: "red" | "green";
  placeholder: string;
  bodyKey: number;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const dot = tone === "green" ? cc.ok : cc.bad;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: dot }}
          aria-hidden
        />
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
      </div>

      <div
        className="flex flex-col overflow-hidden rounded-[var(--radius-lg)] border"
        style={{ backgroundColor: cc.bg, borderColor: cc.border }}
      >
        <TerminalHeader />

        {/* fixed height so rotating between cases never reflows the panel */}
        <div className="h-[24rem] overflow-hidden px-5 py-6">
          {reduce ? (
            <div>{children}</div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={bodyKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeInOut" }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <TerminalInputBar placeholder={placeholder} />
      </div>
    </div>
  );
}

export function SectionComparison() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setActive((i) => (i + 1) % contrastCases.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
    // `active` restarts the dwell timer whenever the user steps the carousel.
  }, [paused, active]);

  const go = (dir: number) =>
    setActive(
      (i) => (i + dir + contrastCases.length) % contrastCases.length,
    );

  const current = contrastCases[active];

  return (
    <section
      id="comparison"
      className="relative border-t border-border py-24 md:py-32"
    >
      <Container>
        <Reveal>
          <div className="mx-auto max-w-4xl text-center">
            <SectionLabel index={2} align="center" className="mb-5">
              the difference
            </SectionLabel>
            <h2 className="text-3xl font-medium lowercase leading-[1.08] tracking-tight md:text-4xl">
              same question. one guess, one check.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Without lurq, the model reaches for what it remembers. With lurq,
              it checks live package data first.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div
            className="mx-auto mt-12 grid max-w-6xl gap-6 lg:max-w-none lg:grid-cols-2 lg:gap-8"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <Terminal
              label="Without lurq"
              tone="red"
              placeholder='Try "add a date library"'
              bodyKey={active}
            >
              <WithoutBody c={current} />
            </Terminal>

            <Terminal
              label="With lurq"
              tone="green"
              placeholder='Try "what should I use for X?"'
              bodyKey={active}
            >
              <WithBody c={current} />
            </Terminal>
          </div>
        </Reveal>

        {/* carousel controls: prev/next + labeled scenario tabs with an
            autoplay progress fill on the active tab */}
        <div
          className="relative z-10 mt-12 flex flex-wrap items-center justify-center gap-3"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous example"
            className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {contrastCases.map((c, i) => {
              const isActive = i === active;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Show ${c.tab} example`}
                  aria-pressed={isActive}
                  className={cn(
                    "relative overflow-hidden rounded-full border px-3.5 py-1.5 font-mono text-xs transition-colors",
                    isActive
                      ? "border-foreground/25 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {/* autoplay progress fill (restarts each time `active` flips) */}
                  {isActive && !paused && !reduce && (
                    <span
                      key={active}
                      aria-hidden
                      className="absolute inset-0 origin-left bg-foreground/[0.08]"
                      style={{
                        animation: `carousel-progress ${ROTATE_MS}ms linear forwards`,
                      }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <span className="opacity-40">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {c.tab.toLowerCase()}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next example"
            className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </Container>
    </section>
  );
}
