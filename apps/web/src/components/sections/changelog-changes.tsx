"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { Tag } from "@/content/changelog";

// Monochrome diff signs. Tone comes from weight, not color.
const sign: Record<Tag, string> = { Added: "+", Changed: "~", Fixed: "✓" };

// Collapsible change list. Native <details> snaps (closed content is
// display:none, so height can't transition); framer-motion animates height
// auto smoothly across browsers instead.
export function ChangelogChanges({
  changes,
}: {
  changes: { tag: Tag; text: string }[];
}) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div className="mt-8 border-t border-border pt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
      >
        <span>Changes ({changes.length})</span>
        <ChevronDown
          className={`size-3.5 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="space-y-3 overflow-hidden"
          >
            {changes.map((c, j) => (
              <li
                key={j}
                className="flex gap-3 border-l border-border pl-4 text-sm leading-relaxed text-muted-foreground first:mt-5"
              >
                <span className="select-none font-mono text-foreground/50">
                  {sign[c.tag]}
                </span>
                <span>{c.text}</span>
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
