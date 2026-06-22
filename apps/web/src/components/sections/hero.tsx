import { SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { CopyCommand } from "@/components/common/copy-command";
import { AuroraBg } from "@/components/visuals/aurora-bg";

export function Hero() {
  return (
    <section className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden px-6 pb-24 pt-32 text-center">
      <AuroraBg />
      <Container className="flex flex-col items-center">
        <Reveal>
          <Badge
            variant="secondary"
            className="rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground"
          >
            Fresh package intelligence for AI coding agents
          </Badge>
        </Reveal>

        <Reveal delay={0.05}>
          <h1 className="mt-6 max-w-4xl text-balance text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
            Objective package recommendations, scored from real signals.
          </h1>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            lurq is a continuously-updated, evidence-scored index of JS/TS
            frameworks and libraries — so your coding agent recommends
            dependencies that are real, healthy, and current, not frozen in
            training data.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row">
            <SignUpButton mode="modal">
              <Button size="lg" className="px-7">
                Get started
              </Button>
            </SignUpButton>
            <CopyCommand command="npx lurq install-skill" />
          </div>
        </Reveal>

        <Reveal delay={0.2}>
          <p className="mt-8 text-sm text-muted-foreground/70">
            Works with Claude Code, Cursor, Windsurf, Copilot, and Codex.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
