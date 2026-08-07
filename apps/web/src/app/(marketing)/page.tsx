import { SiteNav } from "@/components/site/nav";
import { Hero } from "@/components/site/hero";
import { IdeMarquee } from "@/components/site/ide-marquee";
import { AgentSession } from "@/components/site/agent-session";
import { CapabilityGrid } from "@/components/site/capability-grid";
import { DriftBoard } from "@/components/site/drift-board";
import { SiteFooter } from "@/components/site/footer";
import { ScaffoldSection } from "@/components/site/scaffold-section";
import { Faq } from "@/components/site/faq";
import { Contact } from "@/components/site/contact";

/**
 * The page, in order: hero with the video slot, where it installs, the drift
 * board below the fold, the limits, questions, contact, footer.
 *
 * `#limits` is still scaffolding and it is the target of the hero's note line,
 * so nothing above it is allowed to overclaim while it is empty.
 *
 * Background is flat `--ground` plus thin column rules on sections that opt in.
 * Atmosphere comes from the product chrome (drift panel), not a decorated field.
 */
export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <IdeMarquee />
        {/* The first thing on the page that demonstrates rather than asserts,
            and the only section with no heading of its own: the artifact opens
            it. Sits here because the marquee has just said lurq installs
            everywhere, and "so what does it do once it is there" is the next
            question a reader has. */}
        <AgentSession />
        {/* The session shows one call; this shows the whole surface. Reads as
            the expansion of what just happened, which is why it sits here
            rather than after the drift board. */}
        <CapabilityGrid />
        <DriftBoard />
        {/* Scaffolding: see components/site/scaffold-section.tsx. Delete this
            and its component once the section lands. */}
        <ScaffoldSection
          id="limits"
          label="What doesn't work yet"
          note="The target of the hero's note line. Nothing above it is allowed to overclaim while this is empty."
          height={420}
        />
        <Faq />
        <Contact />
      </main>
      <SiteFooter />
    </>
  );
}
