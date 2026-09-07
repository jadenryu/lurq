import type { MetadataRoute } from "next";
import { siteUrl as url } from "@/lib/site";
import { TOOLS } from "@/content/tools";
import { SOLUTIONS } from "@/content/solutions";

// Canonical host: the apex (lurq.run) 308-redirects to www, so www is canonical.
// `siteUrl` normalizes the apex to www so no <loc> points at the redirecting host.

// Public marketing pages only: /dashboard and the auth routes are intentionally
// excluded (and disallowed in robots.ts).

// The tool and solution routes are DERIVED from the same content files that
// generate the pages, not listed by hand. A hand-written sitemap next to a
// [param] route is a list that goes stale the first time someone adds a tool,
// and the failure is silent: the page exists, ships, and is never crawled.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    { url: url("/"), lastModified, changeFrequency: "weekly", priority: 1 },
    { url: url("/product"), lastModified, changeFrequency: "weekly", priority: 0.9 },
    ...TOOLS.map((tool) => ({
      url: url(`/product/${tool.slug}`),
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: url("/solutions"), lastModified, changeFrequency: "weekly", priority: 0.9 },
    ...SOLUTIONS.map((solution) => ({
      url: url(`/solutions/${solution.slug}`),
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    // Weekly rather than monthly: it is regenerated from the registry on every
    // build and changes on every publish.
    { url: url("/changelog"), lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: url("/proof"), lastModified, changeFrequency: "weekly", priority: 0.7 },
    { url: url("/about"), lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: url("/partnerships"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: url("/book-demo"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: url("/license"), lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/privacy"), lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/terms"), lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
