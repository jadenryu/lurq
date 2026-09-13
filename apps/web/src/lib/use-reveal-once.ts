"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Has this section been reached yet." Flips true once and never back.
 *
 * The page's reveal schedule lives in CSS: children carry `--reveal-at` and run
 * when `data-playing="true"` lands on the container. All this hook does is
 * decide when that happens, which is the one part CSS cannot express.
 *
 * VISIBLE UNLESS ARMED. `played` is three-state:
 * - undefined: never armed. The section renders finished, exactly as the server
 *   sent it. This is what crawlers, no-JS captures, reduced-motion readers and
 *   anything that never scrolls get, and a blank panel is the one failure a
 *   reveal must never cause.
 * - false: armed by script, content hidden (CSS keys on the attribute being
 *   present) and waiting for the observer.
 * - true: reached, the entrance runs.
 * Only a section that is still below the fold at hydration is armed, so nothing
 * already on screen blinks out and back in.
 *
 * Both observer conditions below are load-bearing, and both are bugs that shipped:
 *
 * 1. `threshold: 0`, never a ratio. A ratio asks for N% of the section on
 *    screen at once, and once a section is taller than ~8x the viewport that is
 *    unsatisfiable, so the callback never fires.
 *
 * 2. `boundingClientRect.top < 0` as well as `isIntersecting`. The observer
 *    reports current state once on observe() and then only on change, so a
 *    visitor who scrolled past the section before the callback gets one "not
 *    intersecting" and no other. Above the viewport means it has been seen.
 */
export function useRevealOnce<T extends HTMLElement>(
  rootMargin = "0px 0px -12% 0px",
): {
  ref: React.RefObject<T | null>;
  played: boolean | undefined;
} {
  const ref = useRef<T>(null);
  const [played, setPlayed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el || !shouldArmReveal(el)) return;
     
    setPlayed(false);

    const io = new IntersectionObserver(
      (entries) => {
        const reached = entries.some((e) => e.isIntersecting || e.boundingClientRect.top < 0);
        if (reached) {
          setPlayed(true);
          io.disconnect(); // once, so scrolling back up cannot replay it
        }
      },
      { threshold: 0, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, played };
}

/** Script can observe, motion is welcome, and the element is still below the fold. */
export function shouldArmReveal(el: Element): boolean {
  return (
    typeof IntersectionObserver !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    el.getBoundingClientRect().top > window.innerHeight
  );
}
