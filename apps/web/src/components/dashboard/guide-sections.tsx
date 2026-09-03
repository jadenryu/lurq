"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip, Panel, eyebrow } from "@/components/dashboard/panel";
import { DOCS_URL } from "@/lib/site-links";
import { cn } from "@/lib/utils";
import {
  ASSISTANTS,
  CLI_COMMANDS,
  CONFIDENCE,
  TOOLS,
  TOOL_GROUPS,
  TRIGGERS,
} from "@/content/guide";
import Link from "next/link";

/** Numbered mono section marker, matching the marketing site's rhythm. */
export function GuideSection({
  index,
  label,
  title,
  intro,
  children,
}: {
  index: number;
  label: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-8" id={label.replace(/\s+/g, "-")}>
      {/* The bracketed numeral keeps mono — it is a sequence marker and the
          even character widths are the whole effect. The label beside it is a
          word, so it is set like every other label on the site. */}
      <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        <span className="font-mono tracking-[0.16em] text-signal">
          [ {String(index).padStart(2, "0")} ]
        </span>
        <span>{label}</span>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      <h2 className="mt-5 font-heading text-xl font-medium tracking-tight md:text-2xl">{title}</h2>
      {intro && (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{intro}</p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex max-w-xl items-center gap-2">
      <code className="flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
        <span className="mr-2 select-none text-signal">$</span>
        {command}
      </code>
      <Button variant="outline" size="sm" onClick={copy} aria-label="Copy command">
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

// ── 01 · connect ────────────────────────────────────────────────────────────

export function ConnectSection({ hasKey }: { hasKey: boolean }) {
  return (
    <div className="space-y-5">
      <Panel>
        <ol className="space-y-6">
          <li className="flex gap-4">
            <StepNumber n={1} done={hasKey} />
            <div className="min-w-0 flex-1">
              <p className="font-heading text-[0.95rem] font-medium tracking-tight">
                {hasKey ? "You have an API key" : "Create an API key"}
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                One per machine or CI runner. Rotate or revoke any time.
              </p>
              {!hasKey && (
                <Link
                  href="/dashboard/keys"
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-3")}
                >
                  Create a key
                </Link>
              )}
            </div>
          </li>

          <li className="flex gap-4">
            <StepNumber n={2} />
            <div className="min-w-0 flex-1">
              <p className="font-heading text-[0.95rem] font-medium tracking-tight">
                Install the CLI and run setup
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Stores your key, then writes an MCP entry and a skill file for every assistant
                it finds. Once per machine, not once per project. Works with:
              </p>
              <div className="mt-3">
                <CopyableCommand command="npx lurqrun" />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                {ASSISTANTS.map((a) => (
                  <span key={a.label} className="flex items-center gap-2">
                    <Image
                      src={a.logo}
                      alt=""
                      width={16}
                      height={16}
                      className="size-4 opacity-70"
                    />
                    <span className="font-mono text-xs text-muted-foreground">{a.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </li>

          <li className="flex gap-4">
            <StepNumber n={3} />
            <div className="min-w-0 flex-1">
              <p className="font-heading text-[0.95rem] font-medium tracking-tight">
                Restart your agent, then just work
              </p>
              <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                That&apos;s it. You never invoke lurq by name.
              </p>
            </div>
          </li>
        </ol>
      </Panel>
    </div>
  );
}

function StepNumber({ n, done = false }: { n: number; done?: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-chip)] border font-mono text-[0.7rem]",
        done ? "border-ok/40 text-ok" : "border-signal/40 text-signal",
      )}
    >
      {done ? <Check className="size-3.5" /> : n}
    </span>
  );
}

// ── 02 · when it kicks in ───────────────────────────────────────────────────

export function TriggersSection() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border">
      {TRIGGERS.map((t, i) => (
        <div
          key={t.when}
          className={cn(
            "flex flex-col gap-2 p-4 md:flex-row md:items-center md:gap-6 md:p-5",
            i > 0 && "border-t border-border",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.when}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.then}</p>
          </div>
          <code className="shrink-0 self-start rounded-[var(--radius-chip)] border border-signal/30 bg-signal/5 px-2 py-1 font-mono text-xs text-signal md:self-center">
            {t.tool}
          </code>
        </div>
      ))}
    </div>
  );
}

// ── 03 · the tools ──────────────────────────────────────────────────────────

export function ToolsSection() {
  return (
    <div className="space-y-10">
      {TOOL_GROUPS.map((group) => {
        const tools = TOOLS.filter((t) => t.group === group.id);
        if (tools.length === 0) return null;
        return (
          <div key={group.id}>
            <p className={eyebrow}>{group.label}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{group.blurb}</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {tools.map((t) => (
                // Anchored so usage can link a tool bar straight to what that
                // tool actually does. A per-tool call count is only meaningful
                // next to its purpose, and the two lived on different pages
                // with no way across.
                <Panel
                  key={t.name}
                  id={`tool-${t.name}`}
                  padding="tight"
                  className="flex scroll-mt-24 flex-col target:border-signal/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="font-mono text-sm text-signal">{t.name}</code>
                    <Chip>tool</Chip>
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {t.purpose}
                  </p>
                  <div className="mt-4 rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2">
                    <p className="font-mono text-xs leading-relaxed">
                      <span className="mr-2 select-none text-signal">&gt;</span>
                      {t.prompt}
                    </p>
                  </div>
                  <p className="mt-3 font-mono text-[0.65rem] leading-relaxed text-ink-3">
                    {t.input}
                  </p>
                </Panel>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 04 · scoring ────────────────────────────────────────────────────────────

export function ScoringSection() {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel padding="tight" className="lg:col-span-2">
        <p className={eyebrow}>confidence labels</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Strength of evidence, not popularity.
        </p>
        <dl className="mt-5 space-y-3">
          {CONFIDENCE.map((c) => (
            <div key={c.label} className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-4">
              <dt className="w-24 shrink-0">
                <Chip tone={c.tone} dot>
                  {c.label}
                </Chip>
              </dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{c.meaning}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel padding="tight">
        <p className={eyebrow}>where scores come from</p>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
          <li>npm registry, downloads and search</li>
          <li>GitHub stars, issues, releases</li>
          <li>deps.dev, OpenSSF scorecard, advisories</li>
          <li>Bundlephobia, bundle size</li>
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Every response carries a <code className="font-mono text-foreground">dataAsOf</code>{" "}
          stamp, and flags itself stale past seven days.
        </p>
      </Panel>
    </div>
  );
}

// ── 04 · repositories ───────────────────────────────────────────────────────

/** The four stages of the repo loop, in the order a user meets them. */
const REPO_STEPS: { title: string; body: string }[] = [
  {
    title: "Connect the GitHub app",
    body: "Read-only on contents and metadata. lurq reads your package.json files and your resolved dependency tree, never a source file, never a lockfile, never history.",
  },
  {
    title: "It scans nightly",
    body: "What you are behind on, which transitive packages carry advisories and which direct dependency pulls each one in, and whether your dependencies still agree with each other on their shared peers.",
  },
  {
    title: "Commit the workflow to go further",
    body: "A scheduled job in your own CI runs the half that needs your source: which of the removed symbols this repo actually references, at which file and line. That check needs no test suite, so an uncovered call site cannot slip past it.",
  },
  {
    title: "Turn on pr mode when you trust it",
    body: "The job starts in analyse-only and reports. Armed, it bumps every manifest declaring the dependency, rewrites the call sites the upgrade broke, runs your tests, drops anything that fails, and opens one pull request.",
  },
];

export function ReposSection() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-2">
        {REPO_STEPS.map((s, i) => (
          <Panel key={s.title} padding="tight" className="flex gap-4">
            <StepNumber n={i + 1} />
            <div className="min-w-0 flex-1">
              <p className="font-heading text-[0.95rem] font-medium tracking-tight">{s.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </Panel>
        ))}
      </div>
      {/* The permission model is the objection every reviewer raises, so it is
          answered on the page rather than left to the docs. */}
      <Panel padding="tight">
        <p className={eyebrow}>what lurq can and cannot do</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          lurq&apos;s GitHub app is read-only and can never write to your repository. Every commit,
          branch and pull request in this loop is made by your own workflow&apos;s{" "}
          <code className="font-mono text-foreground">GITHUB_TOKEN</code>, scoped to that one repo.
          The agent that edits code runs on your runner with no network and no git access, it
          changes files, the workflow does version control. You own the workflow file, so turning
          the whole thing off is <code className="font-mono text-foreground">git rm</code>.
        </p>
      </Panel>
      <Link
        href="/dashboard/repos"
        className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
      >
        Connect a repository
      </Link>
    </div>
  );
}

// ── 05 · cli ────────────────────────────────────────────────────────────────

export function CliSection() {
  return (
    <div>
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-border">
        {CLI_COMMANDS.map((c, i) => (
          <div
            key={c.cmd}
            className={cn(
              "flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-6",
              i > 0 && "border-t border-border",
            )}
          >
            <code className="shrink-0 font-mono text-xs text-foreground md:w-72">{c.cmd}</code>
            <span className="text-sm text-muted-foreground">{c.does}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Most take <code className="font-mono text-foreground">--json</code>. Point at your hosted
        index with <code className="font-mono text-foreground">LURQ_API_KEY</code>.
      </p>
      <a
        href={DOCS_URL}
        className="mt-5 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        full CLI reference in the docs
        <ArrowUpRight className="size-3.5" />
      </a>
    </div>
  );
}
