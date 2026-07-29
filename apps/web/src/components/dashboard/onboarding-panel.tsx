"use client";

import { useState } from "react";
import { Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

const INSTALL_COMMAND = "npx lurqrun install";

/** Shown when every one of the user's keys is unused — nudges them to finish setup. */
export function OnboardingPanel() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="panel-lit relative rounded-[var(--radius-xl)] border border-border p-5 md:p-7">
      <span className="absolute -top-2.5 left-5 z-10 bg-background px-2 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground/60">
        setup
      </span>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-foreground">
          <Terminal className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-base font-medium tracking-tight">Connect a client</p>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
            You&apos;ve generated a key but haven&apos;t used it yet. Run this in your project,
            paste the key when prompted, and lurq will be available in Claude Code, Cursor,
            Windsurf, Copilot, or Codex.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
              {INSTALL_COMMAND}
            </code>
            <Button variant="outline" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
