"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Panel, eyebrow } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";

const INSTALL_COMMAND = "npm i -g lurqrun && lurq setup";

/**
 * The zero-data overview: a setup checklist reflecting real account state.
 *
 * The version this replaced explained itself at length — a paragraph of
 * reassurance under every step, plus a section describing what the other pages
 * would contain. That's the shape of a template, not a tool: it padded the page
 * with prose the reader hasn't asked for and can't act on, and it buried the two
 * things that actually matter (the key, the command).
 *
 * So: three rows, each showing whether it's done, derived from data we already
 * have. No motivational copy, no step descriptions, no restating the nav. The
 * command is the only thing with visual weight because it's the only thing to do.
 */

interface Props {
  hasKey: boolean;
  /** Prefix of the newest active key, shown as proof step 1 is done. */
  keyPrefix?: string | null;
  /** A key has authenticated at least once — the installer worked. */
  connected: boolean;
}

function Row({
  done,
  label,
  children,
  last = false,
}: {
  done: boolean;
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5",
        !last && "border-b border-border",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          done ? "border-ok bg-ok/15 text-ok" : "border-muted-foreground/35",
        )}
      >
        {done && <Check className="size-2.5" strokeWidth={3} />}
      </span>
      <span
        className={cn(
          "w-24 shrink-0 font-mono text-xs lowercase tracking-wide",
          done ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function GettingStarted({ hasKey, keyPrefix, connected }: Props) {
  const [copied, setCopied] = useState(false);
  const done = [hasKey, connected, false].filter(Boolean).length;

  async function copy() {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="max-w-3xl">
      <Panel padding="tight">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
          <p className={eyebrow}>setup</p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground/70">{done}/3</p>
        </div>

        <Row done={hasKey} label="api key">
          {hasKey ? (
            <code className="font-mono text-xs text-muted-foreground">{keyPrefix}…</code>
          ) : (
            <Link
              href="/dashboard/keys"
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              Create key
            </Link>
          )}
        </Row>

        <Row done={connected} label="install">
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-border bg-muted/40 px-3 py-1.5 font-mono text-sm">
              <span className="mr-2 select-none text-signal">$</span>
              {INSTALL_COMMAND}
            </code>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy install command"
              className="shrink-0 rounded-[var(--radius-control)] border border-border p-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </Row>

        <Row done={false} label="first call" last>
          <span className="font-mono text-xs text-muted-foreground/60">
            waiting for your agent
          </span>
        </Row>
      </Panel>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link
          href="/dashboard/guide"
          className="font-mono text-xs text-signal transition-opacity hover:opacity-80"
        >
          how to use lurq →
        </Link>
        <span className="font-mono text-xs text-muted-foreground/50">
          usage, activity and contributions populate after your first call
        </span>
      </div>
    </div>
  );
}
