"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import { robotoMono } from "@/lib/fonts";

const VERSION = "v0.1.0";
const BANNER_H = "2.25rem"; // matches h-9

// Pre-paint on the client (avoids a navbar jump), no-op on the server.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function AnnouncementBar() {
  // In-memory only: dismissing hides it for this view; it returns on reload.
  const [dismissed, setDismissed] = useState(false);

  useIsoLayoutEffect(() => {
    // Push the navbar (and anything reading --banner-h) down by the bar height.
    document.documentElement.style.setProperty("--banner-h", BANNER_H);
    return () => document.documentElement.style.setProperty("--banner-h", "0px");
  }, []);

  function dismiss() {
    setDismissed(true);
    document.documentElement.style.setProperty("--banner-h", "0px");
  }

  if (dismissed) return null;

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
