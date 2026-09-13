import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { PACKAGE_REVALIDATE, fetchPublicPackageList, packagePath } from "@/lib/public-packages";

// Served at /npm/sitemap.xml and listed in robots.ts. One file: the public set is
// capped at 5,000 packages, well under Google's 50,000-per-sitemap limit.
//
// Built per request, not cached. It was revalidated daily, and the first deploy
// built it before the API had /public/packages, so an EMPTY sitemap was cached
// for a day. A crawler reads a sitemap a few times a day, so fetching the list
// each time costs nothing, and a failed read can never outlive the failure.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const list = await fetchPublicPackageList();
  return list.map((p) => ({
    url: siteUrl(packagePath(p.name)),
    lastModified: p.dataAsOf ? new Date(p.dataAsOf) : undefined,
    changeFrequency: PACKAGE_REVALIDATE <= 86_400 ? "daily" : "weekly",
    priority: 0.5,
  }));
}
