import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.lurq.run";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep the app/auth surfaces out of the index.
      disallow: ["/dashboard", "/sign-in", "/sign-up", "/api/"],
    },
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
