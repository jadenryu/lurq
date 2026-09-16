import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep the app/auth surfaces out of the index.
      disallow: ["/dashboard", "/sign-in", "/sign-up", "/api/"],
    },
    // The package and MCP server pages carry their own sitemaps (app/npm, app/mcp).
    sitemap: [`${SITE_ORIGIN}/sitemap.xml`, `${SITE_ORIGIN}/npm/sitemap.xml`, `${SITE_ORIGIN}/mcp/sitemap.xml`],
    host: SITE_ORIGIN,
  };
}
