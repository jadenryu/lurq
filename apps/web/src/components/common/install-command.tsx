"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const MANAGERS = [
  { id: "npx", command: "npx lurqrun install" },
  { id: "pnpm", command: "pnpm dlx lurqrun install" },
  { id: "yarn", command: "yarn dlx lurqrun install" },
  { id: "bun", command: "bunx lurqrun install" },
] as const;

export function InstallCommand({ className }: { className?: string }) {
  const [active, setActive] = useState(0);
  const manager = MANAGERS[active]!;

  return (
    <div className={cn("w-full max-w-md", className)}>
      <div
        role="tablist"
        aria-label="Package manager"
        className="flex items-center gap-1"
      >
        {MANAGERS.map((item, index) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={index === active}
            onClick={() => setActive(index)}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
              index === active
                ? "bg-card/80 text-foreground"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            {item.id}
          </button>
        ))}
      </div>

      <div
        className="mt-2 flex w-full items-center gap-3 rounded-lg border border-border bg-card/60 px-4 py-2.5 font-mono text-sm"
        aria-label={`Install with ${manager.id}: ${manager.command}`}
      >
        <span className="text-foreground/40" aria-hidden>
          $
        </span>
        <code className="flex-1 select-all whitespace-nowrap text-left text-foreground/85">
          {manager.command}
        </code>
      </div>

      <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground/60">
        <Link
          href="/sign-up"
          className="transition-colors hover:text-foreground"
        >
          Sign up to generate your API key
        </Link>
      </p>
    </div>
  );
}
