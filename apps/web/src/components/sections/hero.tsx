"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/common/container";
import { WaitlistDialog } from "@/components/common/waitlist-dialog";
import { CrypticInstall } from "@/components/common/cryptic-install";
import { HeroLiveDemo } from "@/components/visuals/hero-live-demo";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.08 } },
};

type Tab = "install" | "demo";

export function Hero() {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Tab>("demo");
  const animateProps = reduce
    ? {}
    : { initial: "hidden" as const, animate: "show" as const };

  return (
    <section className="relative overflow-hidden pb-10 pt-[calc(var(--banner-h,0px)+6.5rem)] md:pb-14 md:pt-[calc(var(--banner-h,0px)+8rem)]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_50%_at_50%_-8%,rgba(255,255,255,0.09),transparent_62%)]" />
        <div className="bg-grid absolute inset-0 opacity-50" />
      </div>

      <Container>
        <motion.div
          className="mx-auto max-w-3xl text-center"
          variants={stagger}
          {...animateProps}
        >
          <motion.h1
            variants={fadeUp}
            className="font-heading text-[2.15rem] font-medium lowercase leading-[1.05] tracking-tight sm:text-5xl md:text-[3.1rem]"
          >
            the package index for coding agents.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mx-auto mt-5 max-w-xl text-[0.95rem] leading-relaxed text-muted-foreground sm:text-lg"
          >
            Helps your AI pick libraries that work, and catch bad ones before
            they break the build.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <WaitlistDialog
              triggerLabel="get started free"
              triggerClassName="cta-glow"
            />
            <a
              href="#product"
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-4 font-mono text-sm text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              how it works
              <ArrowRight className="size-3.5" />
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          className="mx-auto mt-8 max-w-4xl md:mt-9"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: EASE, delay: reduce ? 0 : 0.4 }}
        >
          <div className="panel-lit overflow-hidden rounded-[var(--radius-lg)] border border-border">
            <div className="flex items-center gap-1 border-b border-border px-2 py-2 sm:px-3">
              {(
                [
                  { id: "demo" as const, label: "Live demo" },
                  { id: "install" as const, label: "Install" },
                ] as const
              ).map(({ id, label }) => {
                const on = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
                      on
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
              <span className="ml-auto hidden font-mono text-[0.65rem] text-muted-foreground/50 sm:inline">
                same question · with and without lurq
              </span>
            </div>

            <div className="p-3 sm:p-4">
              {tab === "demo" ? (
                <HeroLiveDemo />
              ) : (
                <div className="flex min-h-[16.5rem] flex-col items-center justify-center gap-5 px-4 py-8 md:min-h-[17.5rem]">
                  <div className="text-center">
                    <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground/60">
                      install lurq
                    </p>
                    <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                      One command into Claude Code, Cursor, or your coding agent.
                      Unlocks at launch.
                    </p>
                  </div>
                  <CrypticInstall className="max-w-lg" />
                </div>
              )}
            </div>
          </div>

          <p className="mt-3 text-center font-mono text-[0.65rem] text-muted-foreground/45">
            try a need in the demo · see what changes with lurq
          </p>
        </motion.div>
      </Container>
    </section>
  );
}
