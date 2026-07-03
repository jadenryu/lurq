"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import { robotoMono } from "@/lib/fonts";

const VERSION = "v0.1.0";
const BANNER_H = "2.25rem"; // matches h-9
const STORAGE_KEY = "lurq-banner-dismissed";

// Pre-paint on the client (avoids a navbar jump), no-op on the server.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function AnnouncementBar() {
  // null = not yet resolved (SSR + first paint). The bar only renders once we
  // know it wasn't dismissed for this VERSION, so there's no flash or jump. The
  // dismissal persists in localStorage; bumping VERSION re-shows it for everyone.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useIsoLayoutEffect(() => {
    let isDismissed = false;
    try {
      isDismissed = localStorage.getItem(STORAGE_KEY) === VERSION;
    } catch {
      // localStorage blocked (private mode / policy) — just show the bar.
    }
    setDismissed(isDismissed);
    // Push the navbar (and anything reading --banner-h) down by the bar height.
    document.documentElement.style.setProperty("--banner-h", isDismissed ? "0px" : BANNER_H);
    return () => document.documentElement.style.setProperty("--banner-h", "0px");
  }, []);

  function dismiss() {
    setDismissed(true);
    document.documentElement.style.setProperty("--banner-h", "0px");
    try {
      localStorage.setItem(STORAGE_KEY, VERSION);
    } catch {
      // ignore — dismissal just won't persist this session
    }
  }

  if (dismissed !== false) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex h-9 items-center justify-center border-b border-border bg-secondary px-10 text-xs text-secondary-foreground">
      <p className="truncate">
        lurq is in <span className="font-medium">pre-alpha</span>{" "}
        <span className={`${robotoMono.className} text-muted-foreground`}>
          {VERSION}
        </span>{" "}
        · questions or feedback?{" "}
        <a
          href="mailto:contact@lurq.run"
          className="font-medium underline underline-offset-2 transition-colors hover:text-foreground"
        >
          contact@lurq.run
        </a>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
