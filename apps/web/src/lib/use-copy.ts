"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy to clipboard, once, correctly.
 *
 * There were seven implementations of this in the app — keys-panel, repo-setup,
 * guide-sections, onboarding-panel, create-key-dialog, getting-started and the
 * site's own button — and six of them were the same three naive lines:
 *
 *     await navigator.clipboard.writeText(text);
 *     setCopied(true);
 *     setTimeout(() => setCopied(false), 2000);
 *
 * Which is wrong in three ways that only show up for other people.
 * `navigator.clipboard` is undefined on insecure origins and blocked inside
 * several embedded browsers, so the await throws and the component reports
 * success it never had — or worse, the unhandled rejection takes the click with
 * it. The timeout is never cleared, so unmounting mid-confirm sets state on a
 * dead component. And the confirmation is visual only, so a screen reader is
 * told nothing happened at all.
 *
 * One hook: a fallback that actually works where the API is missing, a
 * confirmation that is only claimed when the write succeeded, and a cleared
 * timer. Callers render the label; `role="status"` belongs next to it in the
 * component, which is why that part is not in here.
 *
 * `resetAfter: null` keeps the confirmation until the page reloads, for a copy
 * the reader should be able to glance back at and know they already took.
 */

/** Returns whether the fallback actually put the text on the clipboard. */
function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Off-screen rather than hidden: `display:none` and `visibility:hidden` are
  // both unselectable, and execCommand copies the selection.
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);

  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

export function useCopy(resetAfter: number | null = 1600): {
  copied: boolean;
  /** False when nothing reached the clipboard — callers must not claim success. */
  copy: (text: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = legacyCopy(text);
      }
      // Nothing was copied, so nothing claims it was.
      if (!ok) return false;

      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      if (resetAfter !== null) timer.current = setTimeout(() => setCopied(false), resetAfter);
      return true;
    },
    [resetAfter],
  );

  return { copied, copy };
}
