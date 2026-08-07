"use client";

import { useEffect, useState } from "react";
import {
  STATUS_OK_LABEL,
  STATUS_PENDING_LABEL,
  STATUS_UNREACHABLE,
} from "@/content/copy";
import { cn } from "@/lib/utils";

/**
 * The status dot is the logo. It is not decoration and it is not always green.
 *
 * Three states, and the page never shows a state it hasn't earned: until the
 * first response lands the dot is --declared, because a light that goes green
 * before anything answered is the single worst thing to fake on a page whose
 * whole argument is recorded evidence.
 *
 * It polls /api/health rather than api.lurq.run/healthz directly. That route is
 * a server-side proxy for exactly that endpoint (see app/api/health/route.ts):
 * calling the API host from the browser would depend on it sending CORS
 * headers, and the proxy is also what measures the round trip the nav prints.
 */

type Health = { ok: boolean; latencyMs: number | null };

const POLL_MS = 30_000;

export function StatusDot() {
  const [health, setHealth] = useState<Health | null>(null);
  /** Increments on each successful poll; keys the dot so the pulse restarts. */
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const body = (await res.json()) as Health;
        if (!alive) return;
        setHealth(body);
        if (body.ok) setBeat((b) => b + 1);
      } catch {
        if (alive) setHealth({ ok: false, latencyMs: null });
      }
    }

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const up = health?.ok === true;
  const down = health !== null && !health.ok;

  const label = health === null ? STATUS_PENDING_LABEL : up ? STATUS_OK_LABEL : STATUS_UNREACHABLE;

  return (
    // `title` is the unreachable tooltip. It stays on the wrapper so the hover
    // target is the dot itself rather than a 6px hit area inside it.
    <span className="flex items-center gap-2" title={down ? STATUS_UNREACHABLE : undefined}>
      <span
        // A new key on each successful poll remounts the dot, which is what
        // restarts the pulse. One pulse per poll, not a loop.
        key={beat}
        aria-hidden
        className={cn(
          "inline-block size-[6px] shrink-0 rounded-full",
          up ? "bg-held" : down ? "bg-conflict" : "bg-declared",
          up && "room-beat",
        )}
      />
      <span className="sr-only" role="status">
        {label}
      </span>
      {/* The measured round trip. Furniture next to the wordmark, so it goes at
          900px: the failure state keeps its tooltip at every width. */}
      <span
        aria-hidden
        className="hidden font-mono text-[11px] text-ink-3 min-[900px]:inline"
      >
        {up && health.latencyMs !== null ? `${health.latencyMs}ms` : ""}
      </span>
    </span>
  );
}
