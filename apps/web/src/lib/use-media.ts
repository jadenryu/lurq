"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as reactive state, without a setState-in-effect.
 *
 * `useSyncExternalStore` is the right tool here: matchMedia *is* an external
 * store, and reading it through this hook means the value is available during
 * render instead of one commit late — which matters for anything that decides
 * whether to animate at all, because a frame of the wrong answer is a frame of
 * animation somebody asked not to see.
 *
 * The server snapshot is `false`, so SSR renders the plain, motion-free,
 * narrow-viewport case and React reconciles once the real value is known.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
