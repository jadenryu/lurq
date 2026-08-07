import { SiteNav } from "@/components/site/nav";
import { Hero } from "@/components/site/hero";
import { IdeMarquee } from "@/components/site/ide-marquee";
import { AgentSession } from "@/components/site/agent-session";
import { CapabilityGrid } from "@/components/site/capability-grid";
import { ProvenanceOrbit } from "@/components/site/provenance-orbit";
import { DriftBoard } from "@/components/site/drift-board";
import { SurfaceSwitch } from "@/components/site/surface-switch";
import { SiteFooter } from "@/components/site/footer";
import { Faq } from "@/components/site/faq";
import { Contact } from "@/components/site/contact";

/**
 * ORDER. Claim, demonstration, problem, surface, receipts, distribution, setup,
 * questions, contact.
 *
 * The page is read by three people and this sequence is the compromise between
 * them. A developer wants to see it work before being told anything, so the
 * session comes second. An investor wants the size of the problem and the size
 * of the asset, so the drift board and the provenance section carry the numbers
 * and both sit above the fold-of-attention rather than at the bottom. Everyone
 * wants to know what has actually been built, which is why the two sections that
 * are pure evidence, the board and the orbit, are adjacent: 3,315 packages,
 * 767,884 versions, 1.29M co-install pairs, all measured, all next to the thing
 * that measures them.
 *
 * WHAT MOVED, AND WHY.
 *
 *   IdeMarquee stays second, at request. It was moved to seventh on the argument
 *   that a logo band under the hero is a trust device borrowed from pages with
 *   customers to show. Overruled: it looks right there, and it does answer the
 *   first question the hero raises, which is "does this work with what I use".
 *
 *   DriftBoard was sixth and is now fourth. It is the only section that argues
 *   the problem exists, and it does it with our own index rather than an
 *   assertion. Burying the evidence for the premise below four sections of
 *   solution is backwards.
 *
 *   ProvenanceOrbit follows the grid rather than preceding the board, so the
 *   order is: here is what goes wrong, here is the call that catches it, here is
 *   everything it can answer, here is where all of that comes from.
 *
 * There is no `#limits` section. It was a dashed placeholder for months. The
 * hero's qualifier now points at the FAQ, where "What doesn't work yet?" is the
 * fourth question in the first group.
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
        {/* Answers the first question the hero raises: does this work with the
            editor I already have. */}
        <IdeMarquee />
        {/* Demonstrates rather than asserts, and the only section with no
            heading of its own: the artifact opens it. High on the page because
            the fastest way to make a claim credible is to show the thing
            doing it. */}
        <AgentSession />
        {/* The session caught one conflict in one stack. This is the same
            failure at index scale, measured against published training cutoffs,
            and it is the section that proves the premise rather than restating
            it. */}
        <DriftBoard />
        {/* ── PRODUCT VIDEO ────────────────────────────────────────────────
            Uncomment when the video exists. Nothing else needs changing: the
            slot is self-contained, centred, and sits at the natural break
            between the problem half of the page and the product half.

            Drop the player in place of the <p>, keep the aspect-video wrapper,
            and delete `border-dashed`. Lives here rather than under the hero on
            purpose: an empty 16:9 box was the second thing on the page and it
            made the whole site look unfinished above the fold.

        <div className="w-full px-4 py-16 min-[768px]:px-6 min-[900px]:py-20">
          <div className="mx-auto flex aspect-video w-full max-w-[1000px] items-center justify-center overflow-hidden rounded-2xl border border-dashed border-edge">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
              Product video
            </p>
          </div>
        </div>

            ─────────────────────────────────────────────────────────────── */}
        {/* One call was shown, one failure mode was measured. This is the whole
            surface: everything else it can be asked. */}
        <CapabilityGrid />
        {/* The grid has just claimed five checks. "From what" is the next
            question, and the answer is also the asset: ten hosts, and the index
            built on top of them. */}
        <ProvenanceOrbit />
        {/* The first section that tells anyone how to actually get it. Setup as
            the answer to a question the reader now has, rather than an install
            guide for a product they had not been shown. */}
        <SurfaceSwitch />
        <Faq />
        <Contact />
      </main>
      <SiteFooter />
    </>
  );
}
