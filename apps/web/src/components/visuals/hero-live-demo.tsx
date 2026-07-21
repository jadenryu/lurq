"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { heroScenarios } from "@/content/hero-scenarios";
import { cn } from "@/lib/utils";

/* Soft syntax colors live only inside the mock. Frame is lifted charcoal so
   it sits on the page instead of a pitch-black void. */
const t = {
  bg: "#14161a",
  text: "#e4e4e4",
  dim: "#8a8a8a",
  prompt: "#9db4ff",
  ok: "#7dcea0",
  bad: "#e08b7a",
  accent: "#c4b5fd",
};

const ROTATE_MS = 9000;
const TYPE_MS = 42;

function ScoreRing({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const r = 20;
  const circ = 2 * Math.PI * r;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0">
      <circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="3"
      />
      <motion.circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke={t.accent}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circ}
        transform="rotate(-90 26 26)"
        initial={reduce ? false : { strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ * (1 - value / 100) }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
      />
      <text
        x="26"
        y="30"
        textAnchor="middle"
        fontSize="13"
        fontFamily="var(--font-mono)"
        fill={t.text}
      >
        {value}
      </text>
    </svg>
  );
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.2, delayChildren: 0.15 } },
};
const item = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
};

function Resolution({ id }: { id: string }) {
  const s = heroScenarios.find((x) => x.id === id)!;
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <motion.div variants={item}>
        <p
          className="text-[11px] uppercase tracking-[0.16em]"
          style={{ color: t.dim }}
        >
          model alone
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2">
          <span style={{ color: t.bad }}>✗</span>
          <span style={{ color: t.text }}>{s.stale.pkg}</span>
        </p>
        <p className="mt-0.5 pl-5 text-[12px]" style={{ color: t.dim }}>
          {s.stale.reason}
        </p>
      </motion.div>

      <motion.div
        variants={item}
        className="h-px w-full"
        style={{ background: "rgba(255,255,255,0.07)" }}
      />

      <motion.div variants={item}>
        <p
          className="text-[11px] uppercase tracking-[0.16em]"
          style={{ color: t.accent }}
        >
          + lurq
        </p>
        <div className="mt-2.5 flex items-center gap-3.5">
          <ScoreRing value={s.fresh.score} />
          <div className="min-w-0">
            <p className="flex items-center gap-2">
              <span style={{ color: t.ok }}>⏺</span>
              <span className="truncate" style={{ color: t.accent }}>
                {s.fresh.pkg}
              </span>
            </p>
            <p className="mt-0.5 text-[12px]" style={{ color: t.dim }}>
              {s.fresh.tag}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[12px]" style={{ color: t.text }}>
          <span style={{ color: t.ok }}>→</span> {s.fresh.verdict}
        </p>
      </motion.div>
    </motion.div>
  );
}

export function HeroLiveDemo({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState("");
  const [typingDone, setTypingDone] = useState(false);
  const paused = useRef(false);

  const scenario = heroScenarios[active];

  useEffect(() => {
    const q = heroScenarios[active].query;
    if (reduce) {
      setTyped(q);
      setTypingDone(true);
      return;
    }
    setTyped("");
    setTypingDone(false);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(q.slice(0, i));
      if (i >= q.length) {
        clearInterval(id);
        setTypingDone(true);
      }
    }, TYPE_MS);
    return () => clearInterval(id);
  }, [active, reduce]);

  useEffect(() => {
    if (reduce) return;
    let elapsed = 0;
    const id = setInterval(() => {
      if (paused.current) return;
      elapsed += 250;
      if (elapsed >= ROTATE_MS) {
        clearInterval(id);
        setActive((a) => (a + 1) % heroScenarios.length);
      }
    }, 250);
    return () => clearInterval(id);
  }, [active, reduce]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-lg)] border border-border/70 shadow-2xl shadow-black/40",
        className,
      )}
      style={{ backgroundColor: t.bg }}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#e08b7a]/85" />
        <span className="size-2.5 rounded-full bg-[#e6c07a]/85" />
        <span className="size-2.5 rounded-full bg-[#7dcea0]/85" />
        <span className="ml-2 font-mono text-[0.7rem]" style={{ color: t.dim }}>
          claude-code · lurq
        </span>
        <span
          className="ml-auto flex items-center gap-1.5 font-mono text-[0.65rem]"
          style={{ color: t.dim }}
        >
          <span className="size-1.5 rounded-full bg-[#7dcea0] motion-safe:animate-pulse" />
          live
        </span>
      </div>

      <div className="flex min-h-[17.5rem] flex-col p-4 font-mono text-[12.5px] leading-relaxed md:min-h-[18.5rem] md:p-5">
        <p className="flex flex-wrap gap-x-2">
          <span style={{ color: t.prompt }}>{">"}</span>
          <span style={{ color: t.text }}>{typed}</span>
          {!typingDone && (
            <span
              className="inline-block h-4 w-[7px] animate-pulse align-middle"
              style={{ backgroundColor: t.text }}
            />
          )}
        </p>

        <div className="mt-4 flex-1">
          <AnimatePresence mode="wait">
            {typingDone && <Resolution key={scenario.id} id={scenario.id} />}
          </AnimatePresence>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="mb-2 text-[11px]" style={{ color: t.dim }}>
            try another →
          </p>
          <div className="flex flex-wrap gap-2">
            {heroScenarios.map((sc, i) => {
              const on = i === active;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-pressed={on}
                  className="relative overflow-hidden rounded-full border px-3 py-1 font-mono text-[11px] transition-colors"
                  style={{
                    borderColor: on
                      ? "rgba(255,255,255,0.28)"
                      : "rgba(255,255,255,0.12)",
                    color: on ? t.text : t.dim,
                  }}
                >
                  {on && !reduce && (
                    <span
                      key={active}
                      aria-hidden
                      className="absolute inset-0 origin-left"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        animation: `carousel-progress ${ROTATE_MS}ms linear forwards`,
                      }}
                    />
                  )}
                  <span className="relative z-10">{sc.chip}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
