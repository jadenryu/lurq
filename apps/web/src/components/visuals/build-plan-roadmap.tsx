"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Build plan" composition for the landing page.
//
//   back layer  → the architecture `lurq plan` resolves: a dependency graph
//                 that fans from your app out to one chosen package per stack
//                 slot, with coherence links between picks. Dimmed and masked
//                 so it bleeds into the page background.
//   front layer → a crisp scorecard (animated health ring + live signal
//                 meters) floating on the left: the score behind one node.
//
// Live JSX/SVG, theme-driven (no static image). Numbers mirror the evidence
// vocabulary used elsewhere on the site (see content/contrast.ts).
// ---------------------------------------------------------------------------

// --- architecture graph -----------------------------------------------------
// Coordinates are in a 0–100 space mapped linearly onto the container (the SVG
// edge layer uses preserveAspectRatio="none" so paths line up with the
// HTML-positioned nodes at the same percentages).

type Node = {
  id: string;
  pkg: string;
  slot: string;
  score: number;
  x: number;
  y: number;
};

const ROOT = { x: 27, y: 50 };

const NODES: Node[] = [
  { id: "zod", pkg: "zod", slot: "Validation", score: 99, x: 52, y: 17 },
  { id: "jose", pkg: "jose", slot: "Auth · JWT", score: 97, x: 79, y: 28 },
  { id: "tailwind", pkg: "tailwindcss", slot: "Styling", score: 96, x: 60, y: 48 },
  { id: "ofetch", pkg: "ofetch", slot: "HTTP", score: 88, x: 86, y: 55 },
  { id: "drizzle", pkg: "drizzle-orm", slot: "ORM", score: 91, x: 55, y: 80 },
  { id: "datefns", pkg: "date-fns", slot: "Dates", score: 94, x: 81, y: 78 },
];

// cross-slot coherence checks: picks that must agree with each other
const COHERENCE: [string, string][] = [
  ["zod", "jose"],
  ["zod", "drizzle"],
  ["tailwind", "ofetch"],
];

const byId = (id: string) => NODES.find((n) => n.id === id)!;

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
}

function NodeCard({ node }: { node: Node }) {
  const strong = node.score >= 95;
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
    >
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card/90 px-3 py-2 shadow-md shadow-black/30">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            strong ? "bg-emerald-400/90" : "bg-foreground/40",
          )}
        />
        <div className="leading-tight">
          <div className="font-mono text-[12.5px] text-foreground/85">
            {node.pkg}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/60">
            {node.slot} · {node.score}
          </div>
        </div>
      </div>
    </div>
  );
}

function BackArchitecture() {
  return (
    <div className="relative h-full w-full select-none">
      {/* edges */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {/* root → each slot */}
        {NODES.map((n) => (
          <path
            key={n.id}
            d={curve(ROOT, n)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
            className="text-foreground/25"
          />
        ))}
        {/* coherence links between picks */}
        {COHERENCE.map(([a, b]) => (
          <path
            key={`${a}-${b}`}
            d={curve(byId(a), byId(b))}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
            className="text-foreground/15"
          />
        ))}
      </svg>

      {/* root node */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${ROOT.x}%`, top: `${ROOT.y}%` }}
      >
        <div className="flex items-center gap-2.5 rounded-xl border border-foreground/20 bg-secondary px-3.5 py-2.5 shadow-lg shadow-black/40">
          <span className="size-2 rounded-full bg-foreground/70" />
          <div className="leading-tight">
            <div className="font-mono text-[13px] font-medium text-foreground">
              ts-api-server
            </div>
            <div className="font-mono text-[10px] text-muted-foreground/70">
              6 slots resolved
            </div>
          </div>
        </div>
      </div>

      {/* package nodes */}
      {NODES.map((n) => (
        <NodeCard key={n.id} node={n} />
      ))}
    </div>
  );
}

// --- scorecard panel --------------------------------------------------------

const PACKAGE = {
  name: "date-fns",
  meta: "npm · MIT · TypeScript",
  score: 94,
  confidence: "High confidence",
};

type Signal = { label: string; value: string; fill: number };

const SIGNALS: Signal[] = [
  { label: "Weekly downloads", value: "21.4M", fill: 0.95 },
  { label: "Release cadence", value: "3 weeks ago", fill: 0.8 },
  { label: "Maintainer activity", value: "Active", fill: 0.86 },
  { label: "Known advisories", value: "0 · clean", fill: 1 },
  { label: "Bundle, tree-shaken", value: "~3 KB", fill: 0.92 },
];

const RING_SIZE = 116;
const RING_STROKE = 5;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

function ScoreRing({ active }: { active: boolean }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? PACKAGE.score : 0);
  const target = PACKAGE.score / 100;

  useEffect(() => {
    if (reduce || !active) return;
    const controls = animate(0, PACKAGE.score, {
      duration: 1.3,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setN(Math.round(v)),
    });
    return () => controls.stop();
  }, [active, reduce]);

  return (
    <div className="relative grid shrink-0 place-items-center">
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          className="text-foreground/10"
        />
        <motion.circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          className="text-foreground"
          initial={false}
          animate={{
            strokeDashoffset: active || reduce ? RING_C * (1 - target) : RING_C,
          }}
          transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>

      <div className="absolute flex flex-col items-center">
        <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
          {n}
        </span>
        <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Health
        </span>
      </div>
    </div>
  );
}

function SignalRow({ signal, active }: { signal: Signal; active: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 font-mono text-[11px]">
        <span className="text-muted-foreground">{signal.label}</span>
        <span className="tabular-nums text-foreground">{signal.value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
        <motion.div
          className="h-full origin-left rounded-full bg-foreground/85"
          initial={false}
          animate={{ scaleX: active || reduce ? signal.fill : 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: "left" }}
        />
      </div>
    </div>
  );
}

function ScorecardPanel() {
  const ref = useRef<HTMLDivElement>(null);
  const active = useInView(ref, { once: true, margin: "0px 0px -100px 0px" });

  return (
    <div
      ref={ref}
      className="w-[22rem] overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-2xl shadow-black/50 backdrop-blur-sm md:w-[24rem]"
    >
      {/* identity + ring */}
      <div className="flex items-center justify-between gap-4 p-5 md:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-foreground/70" />
            <span className="truncate font-mono text-xl font-semibold tracking-tight">
              {PACKAGE.name}
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {PACKAGE.meta}
          </p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-foreground/60" />
            {PACKAGE.confidence}
          </p>
        </div>

        <ScoreRing active={active} />
      </div>

      {/* signal readout */}
      <div className="border-t border-border p-5 md:p-6">
        <div className="grid gap-y-3.5">
          {SIGNALS.map((signal) => (
            <SignalRow key={signal.label} signal={signal} active={active} />
          ))}
        </div>
      </div>

      {/* footnote */}
      <div className="border-t border-border px-5 py-3.5 md:px-6">
        <p className="font-mono text-[10px] text-muted-foreground">
          Live readout · sourced from npm · GitHub · deps.dev
        </p>
      </div>
    </div>
  );
}

export function BuildPlanRoadmap({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative h-[34rem] w-full overflow-hidden md:h-[44rem]",
        className,
      )}
    >
      {/* ambient glow: gives the composition presence instead of sitting flat */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 32% 45%, color-mix(in oklch, var(--foreground) 7%, transparent), transparent 60%)",
        }}
      />

      {/* back layer: architecture graph, masked so its right/bottom edges
          bleed into the page background instead of ending in a hard line */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.7]"
        style={{
          maskImage:
            "linear-gradient(to right, black 58%, transparent 98%), linear-gradient(to bottom, black 84%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, black 58%, transparent 98%), linear-gradient(to bottom, black 84%, transparent 100%)",
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
        }}
      >
        <BackArchitecture />
      </div>

      {/* front layer: focal scorecard, aligned to the site content gutter */}
      <div className="absolute inset-0 mx-auto flex max-w-[1440px] items-center px-6 md:px-10">
        <ScorecardPanel />
      </div>
    </div>
  );
}
