import { SiteNav } from "@/components/site/nav";
import { Hero } from "@/components/site/hero";
import { IdeMarquee } from "@/components/site/ide-marquee";
import { AgentSession } from "@/components/site/agent-session";
import { HowItWorks } from "@/components/site/how-it-works";
import { CapabilityGrid } from "@/components/site/capability-grid";
import { ProductShowcase } from "@/components/site/product-showcase";
import { ProvenanceOrbit } from "@/components/site/provenance-orbit";
import { DriftBoard } from "@/components/site/drift-board";
import { SolutionsStrip } from "@/components/site/solutions-strip";
import { SurfaceSwitch } from "@/components/site/surface-switch";
import { Pricing } from "@/components/site/pricing";
import { SiteFooter } from "@/components/site/footer";
import { Faq } from "@/components/site/faq";
import { Contact } from "@/components/site/contact";

/**
 * ORDER. Claim, compatibility, demonstration, mechanism, problem, surface,
 * schema, provenance, use cases, setup, price, questions, contact.
 *
 * The page is read by three people and this sequence is the compromise between
 * them. A developer wants to see it work before being told anything, so the
 * session comes third. An investor wants the size of the problem and the size
 * of the asset, so the drift board and the provenance section carry the numbers
 * and both sit above the fold-of-attention rather than at the bottom. Everyone
 * wants to know what has actually been built, which is why the two sections that
 * are pure evidence, the board and the orbit, both sit next to something that
 * measures.
 *
 * WHAT MOVED, AND WHY.
 *
 *   IdeMarquee stays second, at request. It was moved to seventh on the argument
 *   that a logo band under the hero is a trust device borrowed from pages with
 *   customers to show. Overruled: it looks right there, and it does answer the
 *   first question the hero raises, which is "does this work with what I use".
 *
 *   DriftBoard was sixth and is now fifth. It is the only section that argues
 *   the problem exists, and it does it with our own index rather than an
 *   assertion. Burying the evidence for the premise below four sections of
 *   solution is backwards.
 *
 *   ProvenanceOrbit follows the grid rather than preceding the board, so the
 *   order is: here is what goes wrong, here is the call that catches it, here is
 *   everything it can answer, here is where all of that comes from.
 *
 * THREE SECTIONS ADDED IN THIS PASS.
 *
 *   HowItWorks, fourth. The page had no answer anywhere to the most load-bearing
 *   fact about the product: that the call happens in the gap BEFORE an install
 *   rather than after one. It was in the footer blurb and nowhere else, and a
 *   reader could finish the whole page believing this was a linter. It sits
 *   directly under the session because the session has just shown a call landing
 *   and the obvious next question is where that call sits in time.
 *
 *   ProductShowcase, seventh, immediately after the grid. The grid names five
 *   questions; this names all ten tools and prints the request body for each.
 *   That is the escalation a developer wants and the site had no page for: it
 *   was possible to read every word here without ever seeing what an agent
 *   actually sends. It goes BEFORE the orbit rather than after, because the
 *   orbit's job is to answer "from what", and it answers it better after ten
 *   claims than after five.
 *
 *   SolutionsStrip, ninth. Four doors into the four use-case pages, placed after
 *   the product is fully explained and before the install section. "When would I
 *   use this" is a question a reader can only have once they know what it does,
 *   and it is the last one standing between them and the setup instructions.
 *
 * There is no #limits section. It was a dashed placeholder for months. The
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
        {/* The session showed a call. This says where in time that call sits,
            which is the one thing the page never stated. */}
        <HowItWorks />
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
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
              Product video
            </p>
          </div>
        </div>

            ─────────────────────────────────────────────────────────────── */}
        {/* One call was shown, one failure mode was measured. This is the whole
            surface: everything else it can be asked. */}
        <CapabilityGrid />
        {/* The same surface again, one level down: the ten tools by name, with
            the request body each one takes. The grid is the questions, this is
            the calls. */}
        <ProductShowcase />
        {/* Ten claims have just been made. "From what" is the next question, and
            the answer is also the asset: ten hosts, and the index built on top
            of them. */}
        <ProvenanceOrbit />
        {/* Now that it is clear what this does, the last question before setup:
            when would I reach for it. Four doors, four pages. */}
        <SolutionsStrip />
        {/* The first section that tells anyone how to actually get it. Setup as
            the answer to a question the reader now has, rather than an install
            guide for a product they had not been shown. */}
        <SurfaceSwitch />
        {/* Cost is the question that follows "here is how to install it", so
            it sits between setup and the FAQ. Cards are priced from
            core/plans.ts, the same table the 402 meters against. The Pro button
            degrades to "Checkout isn't available yet" plus a contact link when
            Stripe is unset, so this is safe to ship ahead of live keys. */}
        <Pricing />
        <Faq />
        <Contact />
      </main>
      <SiteFooter />
    </>
  );
}
