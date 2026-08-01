import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { BuildPlanRoadmap } from "@/components/visuals/build-plan-roadmap";

export function SectionRoadmap() {
  return (
    <section
      id="plan"
      className="relative overflow-hidden border-t border-border py-24 md:py-32"
    >
      <Container>
        <Reveal>
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
            {/* left: oversized title */}
            <h2 className="text-4xl font-medium lowercase leading-[1.04] tracking-tight md:text-5xl">
              agents don&apos;t buy
              <br />
              one thing at a time.
            </h2>

            {/* right: description */}
            <div className="lg:pt-1">
              <p className="text-lg leading-relaxed text-muted-foreground md:text-xl">
                One prompt fills a whole cart.{" "}
                <span className="font-mono text-foreground">lurq plan</span> sources
                every slot at once, auth, validation, database, styling, and
                checks the picks hold together. That is the unit of demand this
                market is built around: not a lookup, a stack.
              </p>
            </div>
          </div>
        </Reveal>
      </Container>

      {/* full-bleed layered build-plan visual */}
      <Reveal delay={0.1} className="mt-16 md:mt-24">
        <BuildPlanRoadmap />
      </Reveal>
    </section>
  );
}
