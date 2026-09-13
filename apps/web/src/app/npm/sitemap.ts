import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { PACKAGE_REVALIDATE, fetchPublicPackageList, packagePath } from "@/lib/public-packages";

// Served at /npm/sitemap.xml and listed in robots.ts. One file: the public set is
// capped at 5,000 packages, well under Google's 50,000-per-sitemap limit.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const list = await fetchPublicPackageList();
  return list.map((p) => ({
    url: siteUrl(packagePath(p.name)),
    lastModified: p.dataAsOf ? new Date(p.dataAsOf) : undefined,
    changeFrequency: PACKAGE_REVALIDATE <= 86_400 ? "daily" : "weekly",
    priority: 0.5,
  }));
}
