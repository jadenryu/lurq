"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { SectionLabel } from "@/components/common/section-label";
import { benchmark } from "@/content/benchmark";
import { cn } from "@/lib/utils";

const MAX = 100;
const CHART_H = 220; // px for bar track

function VerticalChart() {
  const reduce = useReducedMotion();
  const { chart } = benchmark;
  const lead = chart.bars.find((b) => b.kind === "lurq");

  return (
    <div className="panel-lit rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
            {chart.title}
          </p>
          <p className="mt-1 font-mono text-[0.65rem] text-muted-foreground/50">
            {chart.dataset}
          </p>
        </div>
        <span className="font-mono text-[0.65rem] text-muted-foreground/50">
          {chart.hint}
        </span>
      </div>

      {/* Y-axis + bars */}
      <div className="mt-8 flex gap-3">
        <div
          className="flex w-8 shrink-0 flex-col justify-between pb-10 font-mono text-[0.6rem] text-muted-foreground/45"
          style={{ height: CHART_H + 40 }}
        >
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>

        <div className="relative min-w-0 flex-1">
          {/* grid lines */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 border-t border-border/60"
            style={{ height: CHART_H }}
          >
            <div className="absolute inset-x-0 top-1/2 border-t border-border/40" />
            <div className="absolute inset-x-0 bottom-0 border-t border-border/60" />
          </div>

          <div
            className="relative flex items-end justify-between gap-2 sm:gap-3"
            style={{ height: CHART_H }}
          >
            {chart.bars.map((bar, i) => {
              const isLurq = bar.kind === "lurq";
              const h = (bar.value / MAX) * CHART_H;
              return (
                <div
                  key={bar.id}
                  className="flex h-full flex-1 flex-col items-center justify-end"
                >
                  <span
                    className={cn(
                      "mb-1.5 font-mono text-[0.65rem] tabular-nums sm:text-xs",
                      isLurq ? "text-foreground" : "text-muted-foreground/70",
                    )}
                  >
                    {bar.value}%
                  </span>
                  <motion.div
                    className={cn(
                      "w-full max-w-[3.25rem] rounded-t-sm",
                      isLurq
                        ? "glow-brand bg-foreground"
                        : "bg-[color-mix(in_oklab,var(--foreground)_22%,transparent)]",
                    )}
                    style={{ transformOrigin: "bottom" }}
                    initial={reduce ? false : { scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={{ once: true, margin: "0px 0px -40px 0px" }}
                    transition={{
                      duration: 0.85,
                      ease: [0.22, 1, 0.36, 1],
                      delay: reduce ? 0 : 0.08 + i * 0.07,
                    }}
                  >
                    <div style={{ height: h }} />
                  </motion.div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex justify-between gap-2">
            {chart.bars.map((bar) => (
              <span
                key={bar.id}
                className={cn(
                  "flex-1 text-center font-mono text-[0.55rem] leading-tight sm:text-[0.65rem]",
                  bar.kind === "lurq"
                    ? "text-foreground"
                    : "text-muted-foreground/60",
                )}
              >
                {bar.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {lead ? (
        <div className="mt-6 flex items-center gap-2 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
          <span className="inline-block size-2 rounded-full bg-foreground" />
          {lead.label}
          <span className="text-foreground">{lead.value}%</span>
        </div>
      ) : null}
    </div>
  );
}

function Methodology() {
  const m = benchmark.methodology;
  return (
    <div className="panel-lit flex h-full flex-col rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground/70">
        Methodology
      </p>
      <ul className="mt-5 space-y-3">
        {m.bullets.map((b) => (
          <li
            key={b}
            className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground"
          >
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground/50">
          Error categories
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {m.categories.map((c) => (
            <span
              key={c}
              className="rounded-sm border border-border px-2 py-1 font-mono text-[0.65rem] text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SectionBenchmark() {
  return (
    <section
      id="benchmark"
      className="relative border-t border-border py-20 md:py-28"
    >
      <Container>
        <Reveal>
          <div className="max-w-2xl">
            <SectionLabel index={3} className="mb-5">
              {benchmark.eyebrow} · early
            </SectionLabel>
            <h2 className="text-3xl font-medium lowercase leading-[1.08] tracking-tight md:text-4xl">
              {benchmark.heading}
            </h2>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              {benchmark.sub}
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <div className="panel-lit relative mt-12 rounded-[var(--radius-xl)] border border-border">
            <span className="absolute -top-2.5 left-5 z-10 bg-background px-2 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground/60">
              key metrics
            </span>
            <div className="grid gap-6 p-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border sm:p-0">
              {benchmark.metrics.map((m) => (
                <div key={m.label} className="sm:px-8 sm:py-7">
                  <p className="font-heading text-3xl font-semibold tracking-tight md:text-4xl">
                    {m.value}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{m.label}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
            <VerticalChart />
            <Methodology />
          </div>
        </Reveal>

        <p className="mt-8 max-w-2xl font-mono text-[0.7rem] leading-relaxed text-muted-foreground/50">
          {benchmark.note}
        </p>
      </Container>
    </section>
  );
}
