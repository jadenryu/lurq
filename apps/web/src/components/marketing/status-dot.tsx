"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Health = { ok: boolean; upstream: number | null; latencyMs: number | null };

/**
 * Wired to the hosted server's own health check, through /api/health.
 *
 * A hardcoded status light on a page whose whole argument is recorded evidence
 * would be the worst possible thing to fake, so this reports three states and
 * only claims the server is up when it answered: unknown while the request is in
 * flight, reachable, or not reachable.
 *
 * `compact` is the nav form — a dot with the latency on hover, since the nav has
 * no room for a sentence and the dot is the part people read anyway.
 */
export function StatusDot({ compact = false }: { compact?: boolean }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((h: Health) => alive && setHealth(h))
      .catch(() => alive && setHealth({ ok: false, upstream: null, latencyMs: null }));
    return () => {
      alive = false;
    };
  }, []);

  const label =
    health === null
      ? "checking api.lurq.run"
      : health.ok
        ? `api.lurq.run responding${health.latencyMs !== null ? ` · ${health.latencyMs}ms` : ""}`
        : "api.lurq.run not responding";

  const dot = (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        health === null ? "bg-ink-soft/40" : health.ok ? "bg-verified" : "bg-conflict",
      )}
    />
  );

  if (compact) {
    return (
      <span className="group relative flex items-center" title={label}>
        {dot}
        <span className="sr-only">{label}</span>
        <span className="t-label pointer-events-none absolute left-4 whitespace-nowrap opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100">
          {label}
        </span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      {dot}
      <span>{label}</span>
    </span>
  );
}
