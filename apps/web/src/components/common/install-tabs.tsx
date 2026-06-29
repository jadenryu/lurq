"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// Same `install-skill` command across the common JS package managers.
// They all resolve from the npm registry; only the run syntax differs.
// The package ships as `lurqrun` (the bare `lurq` name is blocked on npm);
// it still exposes the `lurq` binary once installed.
const MANAGERS = [
  { id: "npx", command: "npx lurqrun install-skill" },
  { id: "pnpm", command: "pnpm dlx lurqrun install-skill" },
  { id: "yarn", command: "yarn dlx lurqrun install-skill" },
  { id: "bun", command: "bunx lurqrun install-skill" },
] as const;

export function InstallTabs({ className }: { className?: string }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const command = MANAGERS[active]!.command;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (e.g. insecure context): no-op
    }
  }

  return (
    <div className={cn("w-full max-w-md", className)}>
      <div
        role="tablist"
        aria-label="Package manager"
        className="flex items-center gap-1"
      >
        {MANAGERS.map((m, i) => (
          <button
            key={m.id}
            role="tab"
            type="button"
            aria-selected={i === active}
            onClick={() => {
              setActive(i);
              setCopied(false);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
              i === active
                ? "bg-card/80 text-foreground"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            {m.id}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={copy}
        aria-label={`Copy command: ${command}`}
        className="group mt-2 flex w-full items-center gap-3 rounded-lg border border-border bg-card/60 px-4 py-2.5 font-mono text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <span className="text-foreground/40">$</span>
        <span className="flex-1 text-left">{command}</span>
        {copied ? (
          <Check className="size-4 shrink-0 text-foreground" />
        ) : (
          <Copy className="size-4 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
        )}
      </button>
    </div>
  );
}
