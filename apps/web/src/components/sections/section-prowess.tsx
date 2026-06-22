import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { features } from "@/content/features";

export function SectionProwess() {
  return (
    <section className="relative border-t border-border py-24 md:py-32">
      <Container>
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Why lurq
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Built to outperform the alternatives.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Most tools hand your agent stale or popularity-ranked guesses. lurq
              is fresh, objective, and verifiable.
            </p>
          </div>
        </Reveal>

        <div className="mx-auto mt-14 flex max-w-4xl flex-col gap-4 md:gap-5">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.title} delay={i * 0.05}>
                <div className="group flex flex-col gap-5 rounded-[var(--radius-lg)] border border-border bg-card p-6 transition-colors hover:border-foreground/20 hover:bg-secondary/40 md:flex-row md:items-center md:gap-8 md:p-8">
                  <div className="flex items-center gap-4 md:w-48 md:shrink-0">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
                      <Icon className="size-5 text-foreground" />
                    </div>
                    <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {f.label}
                    </span>
                  </div>

                  <div className="flex-1">
                    <h3 className="text-lg font-medium">{f.title}</h3>
                    <p className="mt-1.5 text-muted-foreground">{f.body}</p>
                  </div>

                  {f.stat ? (
                    <div className="font-mono text-xs text-muted-foreground/60 md:w-28 md:shrink-0 md:text-right">
                      {f.stat}
                    </div>
                  ) : null}
                </div>
              </Reveal>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
