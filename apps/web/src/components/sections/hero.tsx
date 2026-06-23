import { SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { InstallTabs } from "@/components/common/install-tabs";
import { ConstellationBg } from "@/components/visuals/constellation-bg";
import { TiltedImage } from "@/components/visuals/tilted-image";
import { commitMono } from "@/lib/fonts";
import heroPreview from "@/components/visuals/alessio-soggetti-PdGBci-4jR8-unsplash.jpg";

export function Hero() {
  return (
    <section className="relative flex min-h-[90vh] items-center overflow-hidden px-6 pb-24 pt-32">
      <ConstellationBg />
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-8">
        {/* left — copy, install command, CTA */}
        <div className="flex flex-col items-start text-left">
          <Reveal>
            <h1
              className={`${commitMono.className} max-w-xl text-balance text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl`}
            >
              Objective package recommendations, scored from real signals.
            </h1>
          </Reveal>

          {/* install script (per package manager), directly under the heading */}
          <Reveal delay={0.05}>
            <InstallTabs className="mt-7" />
          </Reveal>

          <Reveal delay={0.15}>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
              lurq is a continuously-updated, evidence-scored index of JS/TS
              frameworks and libraries — so your coding agent recommends
              dependencies that are real, healthy, and current, not frozen in
              training data.
            </p>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="mt-8">
              <SignUpButton>
                <Button size="lg" className="px-7">
                  Get started
                </Button>
              </SignUpButton>
            </div>
          </Reveal>
        </div>

        {/* right — tilted product preview (hidden on small screens) */}
        <Reveal delay={0.15} className="relative hidden lg:block">
          <TiltedImage
            src={heroPreview.src}
            alt="lurq recommending packages inside a coding agent"
          />
        </Reveal>
      </Container>
    </section>
  );
}
