import type { MetadataRoute } from "next";
import { siteUrl as url } from "@/lib/site";

// Canonical host: the apex (lurq.run) 308-redirects to www, so www is canonical.
// `siteUrl` normalizes the apex to www so no <loc> points at the redirecting host.

// Public marketing pages only: /dashboard and the auth routes are intentionally
// excluded (and disallowed in robots.ts).

// Hand-written, because there are no [param] routes left to derive from: the
// /product, /solutions, /proof and /changelog trees were removed and the site is
// the landing page plus the standing pages below. If a generated route group
// comes back, derive its entries from the same content file that renders it
// rather than adding them here by hand.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    { url: url("/"), lastModified, changeFrequency: "weekly", priority: 1 },
    { url: url("/about"), lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: url("/partnerships"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: url("/book-demo"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: url("/license"), lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/privacy"), lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/terms"), lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
