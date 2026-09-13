import { PLAN_LIST } from "@lurq/core/plans";
import { faqs } from "@/content/faq";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * schema.org JSON-LD for the landing page: what lurq is, what it costs, and the
 * FAQ, in the form search engines and AI answer engines read directly.
 *
 * Built from the same sources the page renders (core/plans.ts, content/faq.ts),
 * so the structured data cannot quote a price or an answer the page does not.
 */
export function StructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "lurq",
        url: SITE_ORIGIN,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Linux, Windows",
        description:
          "Checks npm packages before an AI coding agent installs them: hallucinated and typosquatted names, security advisories, deprecated APIs and version conflicts. MCP server and CLI.",
        installUrl: "https://www.npmjs.com/package/lurqrun",
        offers: PLAN_LIST.map((plan) => ({
          "@type": "Offer",
          name: plan.name,
          priceCurrency: "USD",
          price: (plan.priceCents / 100).toFixed(2),
          description: plan.perSeat
            ? `${plan.tagline} Per seat per month, ${plan.minSeats ?? 1}-seat minimum.`
            : plan.priceFrom
              ? `${plan.tagline} Starting price per month.`
              : plan.tagline,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // Escape "<" so no string in the data can close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
