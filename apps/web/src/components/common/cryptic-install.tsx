"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// Pre-launch teaser. We show the recognizable runner prefix (so it reads as a
// real install command) but redact the subcommand behind a static block bar:
// the command can't be copied yet, and the redaction reads as deliberate
// ("not public") rather than the old churning-glyph effect.
const MANAGERS = [
  { id: "npx", prefix: "npx lurqrun", hidden: "install-skill" },
  { id: "pnpm", prefix: "pnpm dlx lurqrun", hidden: "install-skill" },
  { id: "yarn", prefix: "yarn dlx lurqrun", hidden: "install-skill" },
  { id: "bun", prefix: "bunx lurqrun", hidden: "install-skill" },
] as const;

export function CrypticInstall({ className }: { className?: string }) {
  const [active, setActive] = useState(0);
  const m = MANAGERS[active]!;
  // solid redaction bar, sized to the hidden subcommand
  const bar = "▮".repeat(m.hidden.length);

  return (
    <div className={cn("w-full max-w-md", className)}>
      <div
        role="tablist"
        aria-label="Package manager"
        className="flex items-center gap-1"
      >
        {MANAGERS.map((mgr, i) => (
          <button
            key={mgr.id}
            role="tab"
            type="button"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
              i === active
                ? "bg-card/80 text-foreground"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            {mgr.id}
          </button>
        ))}
      </div>

      <div
        className="mt-2 flex w-full items-center gap-3 rounded-lg border border-border bg-card/60 px-4 py-2.5 font-mono text-sm"
        // The real command never reaches the DOM; announce a friendly
        // placeholder to assistive tech instead.
        aria-label="Install command, unlocks at launch"
      >
        <span className="text-foreground/40">$</span>
        <span aria-hidden className="flex-1 whitespace-nowrap text-left">
          <span className="text-foreground/85">{m.prefix} </span>
          <span className="select-none tracking-[-0.05em] text-foreground/25">
            {bar}
          </span>
        </span>
        <Lock className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      </div>

      <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground/60">
        Install unlocks at launch. Join the waitlist
      </p>
    </div>
  );
}
