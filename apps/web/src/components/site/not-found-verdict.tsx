"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * The 404, answered the way lurq answers a package name nobody published: the
 * `verify` call, the CLI's own `✗ NOT A REAL …` headline, and the reason in the
 * CLI's words.
 *
 * The path is read from `location` after hydration, not `usePathname()`: the
 * not-found page is prerendered once, as /_not-found, so the server HTML would
 * name that path and flash it (or keep it, without JS). The server snapshot says
 * "this address" instead.
 *
 * Vermilion marks the verdict (glyph and rule) but never carries the text: at
 * 12.5px on --surface it is 4.3:1, under AA, which is why the home page's
 * session panel does the same.
 */
export function NotFoundVerdict() {
  const path = useSyncExternalStore(noSubscribe, () => location.pathname, () => null);
  const name = path ? `lurq.run${path}` : "this address";

  return (
    <div
      style={{ boxShadow: "0 24px 48px rgba(0,0,0,.35)" }}
      className="overflow-hidden rounded-xl border border-edge border-t-edge-lit bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge bg-surface-2 px-4 py-3 font-mono text-[12px] min-[720px]:px-5">
        <span className="text-ink-3">lurq</span>
        <span aria-hidden className="text-edge-lit">
          ·
        </span>
        <span className="text-ink">verify</span>
        <span className="min-w-0 break-all text-ink-3">{name}</span>
      </div>

      <div className="px-4 py-5 min-[720px]:px-5">
        <p
          style={{ borderColor: "var(--conflict)" }}
          className="border-l-2 pl-4 font-mono text-[12.5px] leading-[1.7]"
        >
          <span className="break-all text-ink-2">{name}</span>
          <span className="whitespace-nowrap pl-3 text-ink">
            <span aria-hidden style={{ color: "var(--conflict)" }}>
              ✗{" "}
            </span>
            NOT A REAL PAGE
          </span>
          <span className="mt-2 block text-ink-2">
            Nothing on lurq.run answers to this path. Check the spelling, or that you are not
            recalling a page that was never published.
          </span>
        </p>
      </div>
    </div>
  );
}
