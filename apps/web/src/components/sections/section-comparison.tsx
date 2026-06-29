"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { contrastCases, type ContrastCase } from "@/content/contrast";

const ROTATE_MS = 5500;

// Claude Code TUI palette: kept theme-independent so the terminal always
// renders dark, exactly like the real CLI.
const cc = {
  bg: "#1f2030",
  border: "#2c2e44",
  text: "#c8cad8",
  dim: "#7e8298",
  blue: "#8b9bf5",
  salmon: "#d18266",
  green: "#79d2a6",
  red: "#e0796f",
};

function Mascot() {
  // pixel-art approximation of the Claude Code crab
  return (
    <svg
      viewBox="0 0 16 9"
      width="34"
      height="19"
      shapeRendering="crispEdges"
      aria-hidden
      className="shrink-0"
    >
      <g fill={cc.salmon}>
        <rect x="3" y="0" width="10" height="2" />
        <rect x="1" y="2" width="14" height="4" />
        <rect x="2" y="6" width="12" height="1" />
        <rect x="2" y="7" width="2" height="1" />
        <rect x="6" y="7" width="2" height="1" />
        <rect x="10" y="7" width="2" height="1" />
      </g>
      <g fill="#1c1d29">
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
          <span className="font-semibold" style={{ color: cc.blue }}>
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
      <span style={{ color: cc.blue }}>{">"}</span>
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
      <p className="flex gap-2 pt-1" style={{ color: cc.red }}>
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
          <span style={{ color: cc.green }}>⏺</span>
          <span style={{ color: cc.text }}>{c.with.toolCall}</span>
        </p>
        <div className="pl-[18px]" style={{ color: cc.dim }}>
          <p className="flex gap-2">
            <span>⎿</span>
            <span>
              <span style={{ color: cc.green }}>{c.with.pkg}</span> · {c.with.score}
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
  const dot = tone === "green" ? cc.green : cc.red;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: dot }}
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

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setActive((i) => (i + 1) % contrastCases.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [paused]);

  const current = contrastCases[active];

  return (
    <section
      id="comparison"
      className="relative border-t border-border py-24 md:py-32"
    >
      <Container>
        <Reveal>
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-4xl font-semibold leading-[1.04] tracking-tight md:text-5xl">
              Same prompt. One agent guesses, the other knows.
            </h2>
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

        {/* rotation indicator */}
        <div className="relative z-10 mt-12 flex items-center justify-center gap-2.5">
          {contrastCases.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show ${c.tab} example`}
              aria-pressed={i === active}
              className="h-1.5 rounded-full transition-all duration-500 ease-in-out"
              style={{
                width: i === active ? 28 : 8,
                backgroundColor:
                  i === active ? "var(--foreground)" : "var(--border)",
              }}
            />
          ))}
        </div>
      </Container>
    </section>
  );
}
