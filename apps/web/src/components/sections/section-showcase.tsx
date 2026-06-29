"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  CalendarCheck,
  ChevronRight,
  Database,
  Network,
  Search,
  Terminal,
  Webhook,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { cn } from "@/lib/utils";

type Pillar = {
  id: string;
  label: string;
  icon: LucideIcon;
  name: string;
  command: string;
  blurb: string;
  detail: string;
  chips: string[];
};

const GROUPS: { label: string; items: Pillar[] }[] = [
  {
    label: "Interfaces",
    items: [
      {
        id: "mcp",
        label: "MCP",
        icon: Network,
        name: "MCP server",
        command: "claude mcp add lurq",
        blurb: "A remote server your coding agent connects to as a tool.",
        detail:
          "Claude Code, Cursor, Windsurf and others call lurq over MCP to fetch fresh, scored recommendations mid-task — compact, token-aware responses built for agents.",
        chips: ["recommend", "evaluate", "compare", "verify", "diagram"],
      },
      {
        id: "cli",
        label: "CLI",
        icon: Terminal,
        name: "Command line",
        command: 'lurq recommend "form library for react"',
        blurb: "The same index, scriptable from your terminal.",
        detail:
          "Every capability is a subcommand — recommend, evaluate, compare, verify, sync — so you can pull scored data into scripts, CI, or your own tooling.",
        chips: ["recommend", "evaluate", "compare", "verify", "sync"],
      },
      {
        id: "api",
        label: "API",
        icon: Webhook,
        name: "HTTP API",
        command: "lurq serve-http",
        blurb: "Self-host the index behind a rate-limited endpoint.",
        detail:
          "Run lurq as a service with API-key auth, helmet, and rate limiting — no database credentials ever touch a client machine.",
        chips: ["/recommend", "/evaluate", "/compare", "/verify"],
      },
      {
        id: "skill",
        label: "Skill",
        icon: Blocks,
        name: "Agent skill",
        command: "lurq install-skill --agent claude-code",
        blurb: "Drop lurq in as an installable skill, no config.",
        detail:
          "The guided installer detects your agent and writes the connection for you, so the index is available the next time it runs.",
        chips: ["Claude Code", "Cursor", "Windsurf", "VS Code", "Codex"],
      },
    ],
  },
  {
    label: "Engine",
    items: [
      {
        id: "index",
        label: "Index",
        icon: Database,
        name: "Package index",
        command: "postgres · synced daily",
        blurb: "A continuously-synced Postgres index of JS/TS libraries.",
        detail:
          "Public signals from npm, GitHub, and deps.dev are ingested and recomputed daily, so the index reflects releases long after a model's training cutoff.",
        chips: ["npm", "GitHub", "deps.dev", "OSV"],
      },
      {
        id: "search",
        label: "Search",
        icon: Search,
        name: "Hybrid search",
        command: "semantic + keyword",
        blurb: "Find packages by need, not just exact name.",
        detail:
          "A hybrid of semantic and keyword search, weighted by quality and freshness, surfaces the right library even when the problem is described loosely.",
        chips: ["semantic", "keyword", "quality", "freshness"],
      },
      {
        id: "cache",
        label: "Cache",
        icon: Zap,
        name: "Response cache",
        command: "redis · ttl",
        blurb: "Optional Redis layer for low-latency reads.",
        detail:
          "Hot recommendations are cached so repeat lookups return in milliseconds, keeping the agent's tool calls fast without re-querying the index.",
        chips: ["redis", "ttl", "keyed", "edge"],
      },
    ],
  },
];

const FLAT = GROUPS.flatMap((g) => g.items);

export function SectionShowcase() {
  const [active, setActive] = useState(0);
  const pillar = FLAT[active];
  const go = (d: number) =>
    setActive((i) => (i + d + FLAT.length) % FLAT.length);

  return (
    <section
      id="product"
      className="relative border-t border-border py-24 md:py-32"
    >
      <Container>
        <div className="grid gap-12 lg:grid-cols-[240px_1fr] lg:gap-16">
          {/* LEFT — surface nav */}
          <Reveal>
            <nav className="font-mono">
              {GROUPS.map((g) => (
                <div key={g.label} className="mb-6">
                  <p className="px-4 text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground/50">
                    {g.label}
                  </p>
                  <ul className="mt-3 space-y-0.5">
                    {g.items.map((t) => {
                      const idx = FLAT.indexOf(t);
                      const on = idx === active;
                      const Icon = t.icon;
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => setActive(idx)}
                            aria-current={on ? "true" : undefined}
                            className={cn(
                              "relative flex w-full items-center gap-3 rounded-sm py-2 pl-4 pr-3 text-left text-sm transition-colors",
                              on
                                ? "bg-foreground/[0.05] text-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground"
                                : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
                            )}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span>{t.label}</span>
                            {on && <ChevronRight className="ml-auto size-3.5" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              <div className="my-5 border-t border-border" />

              <ul className="space-y-2">
                <li>
                  <a
                    href="/book-demo"
                    className="flex items-center gap-3 px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <CalendarCheck className="size-4 shrink-0" />
                    Book a demo →
                  </a>
                </li>
              </ul>
            </nav>
          </Reveal>

          {/* RIGHT — active surface */}
          <Reveal delay={0.1}>
            <div>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    How it works
                  </span>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                    {pillar.name}
                  </h2>
                  <p className="mt-3 max-w-xl text-muted-foreground">
                    {pillar.blurb}
                  </p>
                  <code className="mt-4 inline-flex rounded-sm border border-border bg-background/40 px-3 py-1.5 font-mono text-xs text-foreground/80">
                    {pillar.command}
                  </code>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    aria-label="Previous surface"
                    className="flex size-9 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    aria-label="Next surface"
                    className="flex size-9 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                  >
                    <ArrowRight className="size-4" />
                  </button>
                </div>
              </div>

              {/* framed technical panel */}
              <div className="relative mt-8 overflow-hidden rounded-sm border border-border/70 bg-card/20">
                <span aria-hidden className="absolute left-0 top-0 size-3 border-l border-t border-foreground/40" />
                <span aria-hidden className="absolute right-0 top-0 size-3 border-r border-t border-foreground/40" />
                <span aria-hidden className="absolute bottom-0 left-0 size-3 border-b border-l border-foreground/40" />
                <span aria-hidden className="absolute bottom-0 right-0 size-3 border-b border-r border-foreground/40" />

                {/* placeholder — swap for the real per-surface diagram */}
                <div className="relative flex aspect-[16/9] w-full items-center justify-center md:pr-14">
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:18px_18px]"
                  />
                  <span className="relative font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground/60">
                    {pillar.label} diagram · coming soon
                  </span>
                </div>

                {/* right-edge instrument gutter */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-0 hidden w-14 border-l border-dashed border-border md:block"
                >
                  <span className="absolute right-[1.15rem] top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/50 [writing-mode:vertical-rl]">
                    lurq · {pillar.id}
                  </span>
                  <span className="absolute right-0 top-6 h-6 w-3 border-y border-border" />
                  <span className="absolute bottom-0 right-0 h-12 w-full bg-[radial-gradient(circle,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:6px_6px]" />
                </div>
              </div>

              <p className="mt-8 max-w-2xl leading-relaxed text-muted-foreground">
                {pillar.detail}
              </p>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
