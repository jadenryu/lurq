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
              a package can pass
              <br />
              and the stack still break.
            </h2>

            {/* right: description */}
            <div className="lg:pt-1">
              <p className="text-lg leading-relaxed text-muted-foreground md:text-xl">
                Describe the project once.{" "}
                <span className="font-mono text-foreground">lurq plan</span> fills
                every slot, auth, validation, database, styling, then co-installs
                the set to prove the picks actually hold together. Six good
                packages are not the same thing as a stack that runs.
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
