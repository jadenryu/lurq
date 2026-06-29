"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyCommand({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

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
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy command: ${command}`}
      className={cn(
        "group inline-flex items-center gap-3 rounded-lg border border-border bg-card/60 px-4 py-2.5 font-mono text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
        className,
      )}
    >
      <span className="text-foreground/40">$</span>
      <span>{command}</span>
      {copied ? (
        <Check className="size-4 text-foreground" />
      ) : (
        <Copy className="size-4 opacity-50 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}
