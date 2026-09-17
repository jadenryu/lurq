import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { fetchPublicMcpServerList, mcpServerPath } from "@/lib/public-mcp";

// Served at /mcp/sitemap.xml and listed in robots.ts. Built per request for the
// same reason as app/npm/sitemap.ts: a cached empty sitemap from a deploy that
// raced the API would outlive the race by a day.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const servers = await fetchPublicMcpServerList();
  return servers.map((s) => ({
    url: siteUrl(mcpServerPath(s.name)),
    lastModified: s.dataAsOf ? new Date(s.dataAsOf) : undefined,
    changeFrequency: "daily" as const,
    priority: 0.5,
  }));
}
