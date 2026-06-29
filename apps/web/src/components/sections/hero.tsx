import { ArrowRight } from "lucide-react";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { CrypticInstall } from "@/components/common/cryptic-install";
import { WaitlistDialog } from "@/components/common/waitlist-dialog";
import { HeroParticles } from "@/components/visuals/hero-particles";
import { VideoPlaceholder } from "@/components/visuals/video-placeholder";

// Asymmetric hero that leads on freshness (the one angle the downstream sections
// don't cover). Left: a two-tone weight "turn" (muted setup → bold resolve).
// Right: a placeholder for the product demo video. Strictly monochrome, Geist + mono.
export function Hero() {
  return (
    <section className="relative flex min-h-[92vh] items-center overflow-hidden px-6 pb-16 pt-28">
      <HeroParticles />
      <Container className="relative grid items-center gap-12 lg:grid-cols-[1.3fr_0.75fr] lg:gap-12">
        {/* headline block: muted setup, bold resolve */}
        <div className="max-w-3xl lg:max-w-none">
          <Reveal delay={0.05}>
            <h1 className="font-heading text-[2.75rem] leading-[0.98] tracking-tight sm:text-6xl md:text-7xl">
              <span className="block lg:whitespace-nowrap font-medium text-muted-foreground">
                Your agent&apos;s package
              </span>
              <span className="block lg:whitespace-nowrap font-medium text-muted-foreground">
                knowledge is frozen.
              </span>
              <span className="mt-2 block lg:whitespace-nowrap font-bold text-foreground">
                lurq keeps it current.
              </span>
            </h1>
          </Reveal>

          <Reveal delay={0.15}>
            <CrypticInstall className="mt-9" />
          </Reveal>

          <Reveal delay={0.2}>
            <div className="mt-9 flex flex-col items-start gap-x-7 gap-y-4 sm:flex-row sm:items-center">
              <WaitlistDialog />
              <a
                href="#product"
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                See how it works
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
          </Reveal>
        </div>

        {/* right: product demo video (placeholder) */}
        <Reveal delay={0.2} className="w-full lg:justify-self-end">
          <VideoPlaceholder className="lg:max-w-xl" />
        </Reveal>
      </Container>
    </section>
  );
}
