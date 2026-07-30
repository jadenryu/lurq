"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel, eyebrow } from "@/components/dashboard/panel";

const INSTALL_COMMAND = "npx lurqrun install";

/**
 * Shown when every one of the user's keys is unused — nudges them to finish setup.
 *
 * No icon tile: a glyph in a rounded box beside a heading is decoration, and it
 * made the panel read like a generic marketing callout. The command itself is the
 * subject, so it gets the visual weight.
 */
export function OnboardingPanel() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Panel padding="tight">
      <p className={eyebrow}>finish setup</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Your key hasn&apos;t been used yet. Run this where you code:
      </p>
      <div className="mt-3 flex max-w-xl items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
          <span className="mr-2 select-none text-signal">$</span>
          {INSTALL_COMMAND}
        </code>
        <Button variant="outline" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Panel>
  );
}
