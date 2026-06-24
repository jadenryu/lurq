import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { CrypticInstall } from "@/components/common/cryptic-install";
import { WaitlistDialog } from "@/components/common/waitlist-dialog";
import { HeroParticles } from "@/components/visuals/hero-particles";
import { TiltedImage } from "@/components/visuals/tilted-image";

export function Hero() {
  return (
    <section className="relative flex min-h-[90vh] items-center overflow-hidden px-6 pb-24 pt-32">
      <HeroParticles />
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-8">
        {/* left – copy, install command, CTA */}
        <div className="flex flex-col items-start text-left">
          <Reveal>
            <h1
              className="max-w-xl text-balance font-heading text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl"
            >
              Objective package recommendations, scored from real signals.
            </h1>
          </Reveal>

          {/* install script (per package manager), directly under the heading.
              Pre-launch: the command is perpetually scrambled so it can't be
              read or copied in full until release. */}
          <Reveal delay={0.05}>
            <CrypticInstall className="mt-7" />
          </Reveal>

          <Reveal delay={0.15}>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
              lurq is a continuously-updated, evidence-scored index of JS/TS
              frameworks and libraries - so your coding agent recommends
              dependencies that are real, healthy, and current, not frozen in
              training data.
            </p>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="mt-8">
              <WaitlistDialog />
            </div>
          </Reveal>
        </div>

        {/* right – tilted product preview (hidden on small screens) */}
        <Reveal delay={0.15} className="relative hidden lg:block">
          <TiltedImage
            src="/images/lobostudio-hamburg-RvQYmGfmsKo-unsplash.jpg"
            alt="lurq recommending packages inside a coding agent"
            width={3744}
            height={5616}
            rotateX={15}
            rotateY={15}
          />
        </Reveal>
      </Container>
    </section>
  );
}
