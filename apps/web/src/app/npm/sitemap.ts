import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import {
  PACKAGE_REVALIDATE,
  fetchPublicPackageList,
  fetchPublicUpgradeIndex,
  packagePath,
  upgradePath,
} from "@/lib/public-packages";

// Served at /npm/sitemap.xml and listed in robots.ts. One file: the public set is
// capped at 5,000 packages, well under Google's 50,000-per-sitemap limit.
//
// Built per request, not cached. It was revalidated daily, and the first deploy
// built it before the API had /public/packages, so an EMPTY sitemap was cached
// for a day. A crawler reads a sitemap a few times a day, so fetching the list
// each time costs nothing, and a failed read can never outlive the failure.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Upgrade pages only once their diff is ready: a pending page is noindex, and
  // listing it would hand crawlers a page that asks not to be kept.
  // At most three per package, so the file stays far under the 50,000 limit.
  const [list, upgrades] = await Promise.all([fetchPublicPackageList(), fetchPublicUpgradeIndex()]);
  return [
    ...list.map((p) => ({
      url: siteUrl(packagePath(p.name)),
      lastModified: p.dataAsOf ? new Date(p.dataAsOf) : undefined,
      changeFrequency: (PACKAGE_REVALIDATE <= 86_400 ? "daily" : "weekly") as "daily" | "weekly",
      priority: 0.5,
    })),
    ...upgrades.flatMap((u) =>
      u.pairs.map((pair) => ({
        url: siteUrl(upgradePath(u.package, pair.fromMajor, pair.toMajor)),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ),
  ];
}
