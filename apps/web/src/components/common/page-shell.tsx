import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/common/container";
import { Logo } from "@/components/common/logo";
import { Reveal } from "@/components/common/reveal";
import { Footer } from "@/components/sections/footer";
import { cn } from "@/lib/utils";

// Shared shell for standalone content pages (company, legal, changelog).
// Sticky header + an ambient title block + the marketing footer, so every
// sub-page keeps lurq's dark theme and feels of a piece with the home page.
export function PageShell({
  eyebrow,
  title,
  lead,
  width = "narrow",
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  /** content column width */
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <Container className="flex h-16 items-center justify-between">
          <Link href="/" aria-label="lurq home">
            <Logo />
          </Link>
          <Link
            href="/"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to home
          </Link>
        </Container>
      </header>

      <main className="relative flex-1 overflow-hidden">
        {/* ambient backdrop: faint grid + a soft overhead glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[460px]"
        >
          <div className="bg-grid absolute inset-0" />
          <div className="absolute left-1/2 top-[-160px] h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-foreground/[0.06] blur-[130px]" />
        </div>

        <Container className="relative">
          <div
            className={cn(
              "mx-auto w-full py-16 md:py-24",
              width === "wide" ? "max-w-4xl" : "max-w-3xl",
            )}
          >
            <Reveal>
              {eyebrow ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
                  <span className="size-1.5 rounded-full bg-foreground/60" />
                  {eyebrow}
                </span>
              ) : null}
              <h1 className="mt-5 bg-gradient-to-br from-foreground via-foreground to-foreground/55 bg-clip-text font-heading text-4xl font-bold tracking-tight text-transparent md:text-5xl">
                {title}
              </h1>
              {lead ? (
                <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                  {lead}
                </p>
              ) : null}
            </Reveal>

            <Reveal delay={0.08}>
              <div className="mt-12">{children}</div>
            </Reveal>
          </div>
        </Container>
      </main>

      <Footer />
    </div>
  );
}
