import { SiteHeader } from "@/components/marketing/site-header";
import { Hero } from "@/components/marketing/hero";
import { SectionStack } from "@/components/marketing/section-stack";
import { SectionNumbers } from "@/components/marketing/numbers";
import {
  FeatureProvenance,
  FeatureUsage,
  FeatureVerify,
} from "@/components/marketing/features";
import { SectionWeights } from "@/components/marketing/weights";
import { SectionInstall } from "@/components/marketing/install";
import { SectionLimits } from "@/components/marketing/limits";
import { SectionFaq } from "@/components/marketing/faq";
import { SectionFinalCta } from "@/components/marketing/final-cta";
import { SiteFooter } from "@/components/marketing/site-footer";

/**
 * Show, then prove, then install.
 *
 * The matrix carries the argument nobody else can make — that we know what happens
 * when these packages meet — so it comes first and gets the only breakout width on
 * the page. Everything after it gets the form its data actually wants: a grid for
 * an API surface, two cards for two packages being compared, bars for a weight
 * model, a diagram for a pipeline.
 *
 * Dark three times only — the matrix, the install band, the closing line — so the
 * page has a rhythm rather than six identical panels in a row. And nothing dense
 * sits next to anything dense: the numbers are a held breath after the matrix, and
 * the limits are prose after the diagram.
 */
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <SectionStack />
        <SectionNumbers />
        <FeatureUsage />
        <FeatureVerify />
        <SectionWeights />
        <FeatureProvenance />
        <SectionInstall />
        <SectionLimits />
        <SectionFaq />
        <SectionFinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
