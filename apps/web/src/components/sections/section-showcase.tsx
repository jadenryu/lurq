"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
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
import { SectionLabel } from "@/components/common/section-label";
import { ProductMedia } from "@/components/visuals/product-media";
import { SurfaceVisual } from "@/components/visuals/surface-visuals";
import { surfaceMedia } from "@/content/media";
import { cn } from "@/lib/utils";

type Pillar = {
  id: string;
  label: string;
  group: "interface" | "engine";
  icon: LucideIcon;
  name: string;
  command: string;
  blurb: string;
  detail: string;
  chips: string[];
};

const PILLARS: Pillar[] = [
  {
    id: "mcp",
    label: "MCP",
    group: "interface",
    icon: Network,
    name: "MCP server",
    command: "claude mcp add lurq",
    blurb: "Connect lurq as a tool your coding agent can call.",
    detail:
      "Claude Code, Cursor, Windsurf and others ask lurq mid-task for fresh package picks. Short answers, meant for agents.",
    chips: ["recommend", "evaluate", "compare", "verify"],
  },
  {
    id: "cli",
    label: "CLI",
    group: "interface",
    icon: Terminal,
    name: "Command line",
    command: 'lurq recommend "form library for react"',
    blurb: "The same answers, from your terminal.",
    detail:
      "Recommend, verify, compare, and plan as simple commands. Use them in scripts, CI, or by hand.",
    chips: ["recommend", "evaluate", "compare", "verify"],
  },
  {
    id: "api",
    label: "API",
    group: "interface",
    icon: Webhook,
    name: "HTTP API",
    command: "lurq serve-http",
    blurb: "Run lurq as a service for your own tools.",
    detail:
      "Host it behind an API key and rate limits. Your clients never need database credentials.",
    chips: ["/recommend", "/evaluate", "/compare", "/verify"],
  },
  {
    id: "skill",
    label: "Skill",
    group: "interface",
    icon: Blocks,
    name: "Agent skill",
    command: "npx lurqrun install-skill --agent claude-code",
    blurb: "Install it once. Your agent keeps it.",
    detail:
      "A short installer finds your agent and wires lurq in, so it is ready the next time you open a project.",
    chips: ["Claude Code", "Cursor", "Windsurf", "Codex"],
  },
  {
    id: "index",
    label: "Index",
    group: "engine",
    icon: Database,
    name: "Package index",
    command: "postgres · synced daily",
    blurb: "A live catalog of JS and TS libraries.",
    detail:
      "We pull public signals from npm, GitHub, and deps.dev every day, long after a model's training data stops.",
    chips: ["npm", "GitHub", "deps.dev", "OSV"],
  },
  {
    id: "search",
    label: "Search",
    group: "engine",
    icon: Search,
    name: "Hybrid search",
    command: "semantic + keyword",
    blurb: "Ask for what you need, not just a package name.",
    detail:
      "Describe the job in plain language. lurq finds libraries that fit, ranked by quality and freshness.",
    chips: ["semantic", "keyword", "quality", "freshness"],
  },
  {
    id: "cache",
    label: "Cache",
    group: "engine",
    icon: Zap,
    name: "Response cache",
    command: "redis · ttl",
    blurb: "Fast answers when the same question comes up again.",
    detail:
      "Recent lookups stay warm so your agent does not wait on every repeat ask.",
    chips: ["redis", "ttl", "keyed"],
  },
];

const ROTATE_MS = 6000;

export function SectionShowcase() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dir, setDir] = useState(1);
  const pillar = PILLARS[active];

  useEffect(() => {
    if (paused || reduce) return;
    const id = setInterval(() => {
      setDir(1);
      setActive((i) => (i + 1) % PILLARS.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, reduce, active]);

  const select = (idx: number) => {
    setDir(idx >= active ? 1 : -1);
    setActive(idx);
  };
  const go = (d: number) => {
    setDir(d);
    setActive((i) => (i + d + PILLARS.length) % PILLARS.length);
  };

  const off = reduce ? 0 : 14;
  const variants = {
    enter: (d: number) => ({ opacity: 0, x: d >= 0 ? off : -off }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: d >= 0 ? -off : off }),
  };

  return (
    <section
      id="product"
      className="relative border-t border-border py-24 md:py-32"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Container>
        <Reveal>
          <div className="mb-10 max-w-3xl">
            <SectionLabel index={1} className="mb-5">
              how it works
            </SectionLabel>
            <h2 className="text-3xl font-medium lowercase leading-[1.08] tracking-tight md:text-4xl">
              one place your AI can check packages.
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              Plug lurq into Claude Code, Cursor, or the terminal. Same live
              index, whichever way you work.
            </p>
          </div>
        </Reveal>

        {/* Horizontal surface tabs — fills width, no empty left column */}
        <Reveal delay={0.06}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
            {PILLARS.map((t, i) => {
              const on = i === active;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => select(i)}
                  aria-pressed={on}
                  className={cn(
                    "relative inline-flex items-center gap-2 overflow-hidden rounded-full border px-3 py-1.5 font-mono text-xs transition-colors",
                    on
                      ? "border-foreground/25 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {on && !paused && !reduce && (
                    <span
                      key={active}
                      aria-hidden
                      className="absolute inset-0 origin-left bg-foreground/[0.07]"
                      style={{
                        animation: `carousel-progress ${ROTATE_MS}ms linear forwards`,
                      }}
                    />
                  )}
                  <Icon className="relative z-10 size-3.5" />
                  <span className="relative z-10">{t.label}</span>
                </button>
              );
            })}
          </div>
        </Reveal>

        {/* Dense two-column panel: copy + live visual */}
        <Reveal delay={0.1}>
          <div className="mt-8 grid items-stretch gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
            <div className="flex flex-col">
              <AnimatePresence mode="wait" custom={dir} initial={false}>
                <motion.div
                  key={active}
                  custom={dir}
                  variants={variants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
                  className="flex flex-1 flex-col"
                >
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground/60">
                    {pillar.group}
                  </span>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
                    {pillar.name}
                  </h3>
                  <p className="mt-3 text-muted-foreground">{pillar.blurb}</p>
                  <code className="mt-5 inline-flex w-fit max-w-full truncate rounded-sm border border-border bg-card/40 px-3 py-1.5 font-mono text-xs text-foreground/85">
                    {pillar.command}
                  </code>
                  <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                    {pillar.detail}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {pillar.chips.map((chip) => (
                      <span
                        key={chip}
                        className="rounded-sm border border-border px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="mt-8 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Previous surface"
                  className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Next surface"
                  className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <ArrowRight className="size-4" />
                </button>
                <span className="ml-2 font-mono text-xs text-muted-foreground/50">
                  {String(active + 1).padStart(2, "0")} /{" "}
                  {String(PILLARS.length).padStart(2, "0")}
                </span>
              </div>
            </div>

            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={active}
                custom={dir}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
              >
                <ProductMedia
                  src={surfaceMedia[pillar.id]?.src}
                  gif={surfaceMedia[pillar.id]?.gif}
                  poster={surfaceMedia[pillar.id]?.poster}
                  chrome="window"
                  title={`lurq · ${pillar.id}`}
                  aspect={
                    surfaceMedia[pillar.id]?.src || surfaceMedia[pillar.id]?.gif
                      ? "video"
                      : "auto"
                  }
                  label={`${pillar.name}: ${pillar.blurb}`}
                  className="surface-glow h-full"
                >
                  <SurfaceVisual id={pillar.id} />
                </ProductMedia>
              </motion.div>
            </AnimatePresence>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
