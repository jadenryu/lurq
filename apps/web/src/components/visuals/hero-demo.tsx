"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ProductMedia } from "@/components/visuals/product-media";
import { heroMedia } from "@/content/media";
import { cn } from "@/lib/utils";

// Lifted charcoal frame + soft syntax colors (prompt / ok / accent).
const t = {
  bg: "#14161a",
  text: "#e4e4e4",
  dim: "#8a8a8a",
  prompt: "#9db4ff",
  ok: "#7dcea0",
  accent: "#c4b5fd",
};

type Line = {
  content: React.ReactNode;
  /** ms to wait before revealing the NEXT line */
  after: number;
  indent?: number;
};

const LINES: Line[] = [
  {
    content: (
      <>
        <span style={{ color: t.prompt }}>{">"}</span>{" "}
        <span style={{ color: t.text }}>
          add a library for parsing dates in my TS app
        </span>
      </>
    ),
    after: 900,
  },
  {
    content: (
      <>
        <span style={{ color: t.ok }}>⏺</span>{" "}
        <span style={{ color: t.text }}>lurq</span>
        <span style={{ color: t.dim }}>
          {" "}
          · recommend(&quot;date parsing, typescript&quot;)
        </span>
      </>
    ),
    after: 650,
  },
  {
    content: (
      <span style={{ color: t.dim }}>
        ⎿ <span style={{ color: t.accent }}>date-fns</span> · 94 · proven
      </span>
    ),
    after: 380,
    indent: 1,
  },
  {
    content: (
      <span style={{ color: t.dim }} className="flex justify-between">
        <span>weekly downloads</span>
        <span style={{ color: t.text }}>21M</span>
      </span>
    ),
    after: 300,
    indent: 2,
  },
  {
    content: (
      <span style={{ color: t.dim }} className="flex justify-between">
        <span>last publish</span>
        <span style={{ color: t.text }}>6 days ago</span>
      </span>
    ),
    after: 300,
    indent: 2,
  },
  {
    content: (
      <span style={{ color: t.dim }} className="flex justify-between">
        <span>advisories</span>
        <span style={{ color: t.ok }}>0</span>
      </span>
    ),
    after: 700,
    indent: 2,
  },
  {
    content: (
      <span style={{ color: t.text }}>
        Using <span style={{ color: t.accent }}>date-fns</span>, actively
        maintained, tree-shakeable, 0 advisories.
      </span>
    ),
    after: 2600,
  },
];

function AgentExchange() {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? LINES.length : 0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (reduce) return;
    const step = (i: number) => {
      if (i >= LINES.length) {
        // hold on the final frame, then restart the loop
        timer.current = setTimeout(() => {
          setShown(0);
          timer.current = setTimeout(() => step(0), 500);
        }, LINES[LINES.length - 1].after);
        return;
      }
      setShown(i + 1);
      timer.current = setTimeout(() => step(i + 1), LINES[i].after);
    };
    timer.current = setTimeout(() => step(0), 600);
    return () => clearTimeout(timer.current);
  }, [reduce]);

  return (
    <div
      className="flex min-h-[19rem] flex-col justify-between p-5 md:min-h-[22rem] md:p-7"
      style={{ backgroundColor: t.bg }}
    >
      <div className="space-y-2 font-mono text-[12px] leading-relaxed md:text-[13.5px]">
        <AnimatePresence initial={false}>
          {LINES.slice(0, shown).map((line, i) => (
            <motion.div
              key={i}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              style={{ paddingLeft: `${(line.indent ?? 0) * 1.15}rem` }}
            >
              {line.content}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div
        className="mt-4 flex items-center gap-2 border-t pt-3 font-mono text-[11px]"
        style={{ borderColor: "rgba(255,255,255,0.08)", color: t.dim }}
      >
        <span>›</span>
        <span
          className="inline-block h-3 w-[6px] motion-safe:animate-pulse"
          style={{ backgroundColor: t.text }}
        />
        <span className="ml-auto">lurq · mcp</span>
      </div>
    </div>
  );
}

export function HeroDemo({ className }: { className?: string }) {
  return (
    <ProductMedia
      src={heroMedia.src}
      gif={heroMedia.gif}
      poster={heroMedia.poster}
      chrome="window"
      title="claude-code · lurq"
      aspect={heroMedia.src || heroMedia.gif ? "video" : "auto"}
      label="An agent calling lurq for a scored recommendation mid-task"
      className={cn(className)}
    >
      <AgentExchange />
    </ProductMedia>
  );
}
