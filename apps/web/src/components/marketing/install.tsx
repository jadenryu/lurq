"use client";

import { useState } from "react";
import Link from "next/link";
import { Container } from "@/components/marketing/primitives";
import { CopyCommand } from "@/components/marketing/copy-command";
import {
  ASSISTANTS,
  EDITOR_LOGOS,
  INSTALL_COMMAND,
  MCP_ENDPOINT,
  MCP_TOOLS,
} from "@/lib/marketing-copy";
import { compatExample } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

/**
 * The install band, and the one terminal on the page.
 *
 * Everywhere else the data gets a form that suits what it actually is; here
 * somebody is going to copy a command, so a prompt and a command is exactly
 * right. It's also one of the three dark moments that break the page up.
 *
 * The commands are the real ones: `--agent <id>` is what the installer accepts,
 * and the path under each is the file it edits.
 */

/** Copied by "setup for your agent" — everything an agent needs to wire itself up. */
function agentInstructions(agent: string): string {
  return [
    `# Connect lurq (${agent})`,
    "",
    `Run: npx lurqrun install --agent ${agent}`,
    "",
    "This registers lurq as an MCP server. It will ask for an API key; generate one at",
    "https://www.lurq.run/dashboard/keys.",
    "",
    `Endpoint: ${MCP_ENDPOINT} (Authorization: Bearer <key>)`,
    "",
    `Tools: ${MCP_TOOLS.join(", ")}`,
    "",
    "Use it before installing anything:",
    "- compat  — check a set of packages holds together before committing to it",
    "- usage   — read a version's real exported API instead of recalling it",
    "- verify  — confirm a package name is real and not a typosquat",
  ].join("\n");
}

export function SectionInstall() {
  const [active, setActive] = useState<string>(ASSISTANTS[0].id);
  const assistant = ASSISTANTS.find((a) => a.id === active) ?? ASSISTANTS[0];
  const command = `${INSTALL_COMMAND} --agent ${assistant.id}`;

  return (
    <section id="install" className="bg-viewport py-16 text-viewport-ink md:py-24">
      <Container>
        <p className="t-label mb-5 text-viewport-ink/45">Install</p>

        <h2 className="t-h2 max-w-[26ch] text-viewport-ink">
          One command, into the editor you already use
        </h2>

        <div
          className="mt-8 flex flex-wrap gap-2"
          role="tablist"
          aria-label="Assistant"
        >
          {ASSISTANTS.map((a) => {
            const on = a.id === active;
            return (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(a.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded border px-3 py-2 font-mono text-[0.8125rem] transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-lift",
                  on
                    ? "border-mark-lift/60 bg-viewport-2 text-viewport-ink"
                    : "border-viewport-3 text-viewport-ink/55 hover:border-viewport-ink/30 hover:text-viewport-ink",
                )}
              >
                {/* Brand marks are flattened to one ink — the verdict colours are
                      the only saturated colour on this page. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.logo}
                  alt=""
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 brightness-0 invert",
                    on ? "" : "opacity-55",
                  )}
                />
                {a.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
          <div className="min-w-0 rounded-lg border border-viewport-3 bg-viewport-2/60">
            <p className="t-label border-b border-viewport-3 px-4 py-3 text-viewport-ink/45">
              writes {assistant.path}
            </p>
            <div className="px-4 py-4 sm:px-5">
              <p className="t-data break-words text-viewport-ink">
                <span className="select-none pr-2 text-viewport-ink/30">$</span>
                {command}
              </p>
              <p className="t-data mt-3 text-viewport-ink/45">
                asks for an API key, then registers the server and restarts nothing else
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <CopyCommand
                  command={command}
                  variant="block"
                  className="h-10 rounded px-4 text-[0.8125rem]"
                />
                <CopyCommand
                  command={agentInstructions(assistant.id)}
                  label="copy setup for your agent"
                  variant="block"
                  className="h-10 rounded px-4 text-[0.8125rem]"
                />
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <p className="t-data text-viewport-ink/60">
              Anything else that speaks MCP can point at{" "}
              <span className="text-viewport-ink">{MCP_ENDPOINT}</span> directly. The
              CLI works on its own with no editor at all.
            </p>
            <p className="mt-4">
              <Link
                href="/dashboard/keys"
                className="t-data text-viewport-ink underline decoration-viewport-3 underline-offset-4 transition-colors duration-[120ms] hover:text-mark-lift"
              >
                generate an api key →
              </Link>
            </p>

            {/* The compat command, which used to have a whole section repeating
                  what the graph already shows. It only needed to be copyable. */}
            <div className="mt-8 border-t border-viewport-3 pt-6">
              <p className="t-label mb-3 text-viewport-ink/45">
                check a stack before you commit to it
              </p>
              <CopyCommand
                command={compatExample.reproduce}
                label="npx lurqrun compat …"
                variant="quiet"
              />
            </div>
          </div>
        </div>

        <ul className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 opacity-40">
          {EDITOR_LOGOS.map((e) => (
            <li key={e.name} className="flex h-8 items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={e.logo}
                alt=""
                aria-hidden
                className="size-4 shrink-0 brightness-0 invert"
              />
              <span className="font-mono text-[0.75rem] text-viewport-ink">
                {e.name}
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
