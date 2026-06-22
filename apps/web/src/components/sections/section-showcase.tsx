import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { ProductPanel } from "@/components/visuals/product-panel";
import { DiagramPlaceholder } from "@/components/visuals/diagram-placeholder";

export function SectionShowcase() {
  return (
    <section
      id="product"
      className="relative border-t border-border py-24 md:py-32"
    >
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          {/* left: large product visual */}
          <Reveal className="lg:-ml-12">
            <ProductPanel />
          </Reveal>

          {/* right: oblong container */}
          <Reveal delay={0.1}>
            <div className="rounded-[var(--radius-xl)] border border-border bg-card p-8 md:p-10">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                How it works
              </span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                Recommendations your agent can actually trust.
              </h2>
              <p className="mt-4 text-muted-foreground">
                lurq ingests public signals from npm, GitHub, and deps.dev,
                scores every package for health and confidence, and exposes the
                result to your coding agent over MCP and the CLI.
              </p>
              <p className="mt-3 text-muted-foreground">
                Ask in plain language; get back a short, ranked, evidence-backed
                list — each entry carrying a confidence label and a freshness
                timestamp.
              </p>
              <DiagramPlaceholder className="mt-8" />
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
