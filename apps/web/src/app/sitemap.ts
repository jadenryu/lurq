import type { MetadataRoute } from "next";
import { siteUrl as url } from "@/lib/site";

// Canonical host: the apex (lurq.run) 308-redirects to www, so www is canonical.
// `siteUrl` normalizes the apex to www so no <loc> points at the redirecting host.

// Public marketing pages only — /dashboard and the auth routes are intentionally
// excluded (and disallowed in robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: url("/"), lastModified, changeFrequency: "weekly", priority: 1 },
    { url: url("/about"), lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: url("/partnerships"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: url("/book-demo"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: url("/changelog"), lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: url("/license"), lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/privacy"), lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/terms"), lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
