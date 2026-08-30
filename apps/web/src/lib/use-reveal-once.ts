"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Has this section been reached yet." Flips true once and never back.
 *
 * The page's reveal schedule lives in CSS: children carry `--reveal-at`, start
 * `opacity: 0` with `animation-play-state: paused`, and run when `data-playing`
 * lands on the container. All this hook does is decide when that happens, which
 * is the one part CSS cannot express.
 *
 * Both conditions below are load-bearing, and both are bugs that shipped:
 *
 * 1. `threshold: 0`, never a ratio. A ratio asks for N% of the section on
 *    screen at once, and once a section is taller than ~8x the viewport that is
 *    unsatisfiable, so the callback never fires and the section stays blank
 *    forever. It is invisible on a desktop viewport, where the same section
 *    fits, and it only bites on a phone where the cards have stacked.
 *
 * 2. `boundingClientRect.top < 0` as well as `isIntersecting`. The observer
 *    reports current state once on observe() and then only on change, so a
 *    visitor who has already scrolled past the section by the time React
 *    hydrates gets one callback saying "not intersecting" and no other, ever.
 *    Being above the viewport means it has been seen, which for a reveal is the
 *    same as being in it.
 *
 * Four older sections (capability-grid, agent-session, drift-board,
 * surface-switch) each carry their own copy of this and predate the hook. They
 * work; this exists so the fifth one is not a fifth copy of a rule that took two
 * bug reports to get right.
 */
export function useRevealOnce<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  played: boolean;
} {
  const ref = useRef<T>(null);
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        const reached = entries.some((e) => e.isIntersecting || e.boundingClientRect.top < 0);
        if (reached) {
          setPlayed(true);
          io.disconnect(); // once, so scrolling back up cannot replay it
        }
      },
      { threshold: 0, rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, played };
}
