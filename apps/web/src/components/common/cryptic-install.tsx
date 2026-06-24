"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// Pre-launch teaser: the real install command exists, but we deliberately
// never show it in full. A portion of the characters is always replaced with
// cryptic glyphs that churn a few times a second, so the command reads as
// "live, encrypted, not-yet-public" instead of something a visitor can copy.
const MANAGERS = [
  { id: "npx", command: "npx lurqrun install-skill" },
  { id: "pnpm", command: "pnpm dlx lurqrun install-skill" },
  { id: "yarn", command: "yarn dlx lurqrun install-skill" },
  { id: "bun", command: "bunx lurqrun install-skill" },
] as const;

// Mix of glyphs that keeps a terminal/encrypted feel without looking like noise.
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789!<>-_/[]{}=+*^?#$&%@~".split("");

// Fraction of (non-space) characters hidden at any instant. Kept high so the
// command stays unreadable as a whole, even when staring at it.
const HIDDEN_RATIO = 0.7;
// How often the hidden region drifts to new positions (ms).
const DRIFT_MS = 360;
// How often hidden characters re-roll their glyph (ms) — the slow shimmer.
const CHURN_MS = 130;

function randInt(max: number) {
  return Math.floor(Math.random() * max);
}

export function CrypticInstall({ className }: { className?: string }) {
  const [active, setActive] = useState(0);
  const command = MANAGERS[active]!.command;

  // Indices that are eligible to be hidden (everything except spaces).
  const positions = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < command.length; i++) {
      if (command[i] !== " ") out.push(i);
    }
    return out;
  }, [command]);

  // Set of currently-hidden indices, and the glyph shown at each.
  const hiddenRef = useRef<Set<number>>(new Set());
  const [, force] = useState(0);
  const glyphRef = useRef<Map<number, string>>(new Map());

  // Seed / re-seed the hidden set whenever the target command changes.
  useEffect(() => {
    const count = Math.max(1, Math.round(positions.length * HIDDEN_RATIO));
    const pool = [...positions];
    const hidden = new Set<number>();
    while (hidden.size < count && pool.length) {
      hidden.add(pool.splice(randInt(pool.length), 1)[0]!);
    }
    hiddenRef.current = hidden;
    glyphRef.current = new Map();
    force((n) => n + 1);
  }, [positions]);

  // Slow drift: swap a few hidden positions for new ones so the obscured
  // region wanders across the command instead of staying put.
  useEffect(() => {
    const id = setInterval(() => {
      const hidden = hiddenRef.current;
      const visible = positions.filter((p) => !hidden.has(p));
      const swaps = Math.max(1, Math.round(hidden.size * 0.25));
      const hiddenArr = [...hidden];
      for (let s = 0; s < swaps && visible.length && hiddenArr.length; s++) {
        const reveal = hiddenArr.splice(randInt(hiddenArr.length), 1)[0]!;
        const conceal = visible.splice(randInt(visible.length), 1)[0]!;
        hidden.delete(reveal);
        hidden.add(conceal);
        glyphRef.current.delete(reveal);
        visible.push(reveal);
      }
      force((n) => n + 1);
    }, DRIFT_MS);
    return () => clearInterval(id);
  }, [positions]);

  // Fast churn: re-roll the glyph shown at each hidden position.
  useEffect(() => {
    const id = setInterval(() => {
      const map = glyphRef.current;
      for (const i of hiddenRef.current) {
        map.set(i, GLYPHS[randInt(GLYPHS.length)]!);
      }
      force((n) => n + 1);
    }, CHURN_MS);
    return () => clearInterval(id);
  }, []);

  const hidden = hiddenRef.current;

  return (
    <div className={cn("w-full max-w-md", className)}>
      <div
        role="tablist"
        aria-label="Package manager"
        className="flex items-center gap-1"
      >
        {MANAGERS.map((m, i) => (
          <button
            key={m.id}
            role="tab"
            type="button"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
              i === active
                ? "bg-card/80 text-foreground"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            {m.id}
          </button>
        ))}
      </div>

      <div
        className="mt-2 flex w-full items-center gap-3 rounded-lg border border-border bg-card/60 px-4 py-2.5 font-mono text-sm"
        // The real command never reaches the DOM in legible order; announce a
        // friendly placeholder to assistive tech instead.
        aria-label="Install command — unlocks at launch"
      >
        <span className="text-foreground/40">$</span>
        <span aria-hidden className="flex-1 text-left tracking-tight">
          {command.split("").map((ch, i) => {
            if (ch === " ") return <span key={i}>&nbsp;</span>;
            const isHidden = hidden.has(i);
            return (
              <span
                key={i}
                className={
                  isHidden
                    ? "text-muted-foreground/70"
                    : "text-foreground/85"
                }
              >
                {isHidden ? (glyphRef.current.get(i) ?? "*") : ch}
              </span>
            );
          })}
        </span>
        <Lock className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      </div>

      <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground/60">
        Install unlocks at launch – join the waitlist
      </p>
    </div>
  );
}
