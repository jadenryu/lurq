/**
 * Reads for the public /npm/<name> pages. No secret: these hit the API's public,
 * rate-limited summary routes (src/mcp/publicPackages.ts), and the responses are
 * cached here for a day because a package's headline changes on the scale of a
 * sync, not a request.
 */

export interface PublicAlternative {
  name: string;
  healthScore: number | null;
  confidence: string | null;
}

export interface PublicPackageSummary {
  name: string;
  description: string | null;
  latestVersion: string | null;
  license: string | null;
  category: string | null;
  repoUrl: string | null;
  homepage: string | null;
  healthScore: number | null;
  confidence: string | null;
  weeklyDownloads: number | null;
  stars: number | null;
  lastReleaseAt: string | null;
  deprecated: boolean;
  archived: boolean;
  advisories: { total: number; severe: number } | null;
  verdict: { level: string; reasons: string[] };
  alternatives: PublicAlternative[];
  dataAsOf: string | null;
}

export const PACKAGE_REVALIDATE = 86_400;

function apiBase(): string | null {
  const base = process.env.LURQ_MCP_URL;
  return base ? base.replace(/\/$/, "") : null;
}

/** null when the package has no public summary, or the API is unreachable. */
export async function fetchPublicPackage(name: string): Promise<PublicPackageSummary | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/public/package?name=${encodeURIComponent(name)}`, {
      next: { revalidate: PACKAGE_REVALIDATE },
    });
    return res.ok ? ((await res.json()) as PublicPackageSummary) : null;
  } catch {
    return null;
  }
}

/** The public set, most-downloaded first. Empty when the API is unreachable. */
export async function fetchPublicPackageList(): Promise<{ name: string; dataAsOf: string | null }[]> {
  const base = apiBase();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/public/packages`, { next: { revalidate: PACKAGE_REVALIDATE } });
    if (!res.ok) return [];
    const data = (await res.json()) as { packages?: { name: string; dataAsOf: string | null }[] };
    return data.packages ?? [];
  } catch {
    return [];
  }
}

/** The page path for a package. Scoped names keep their slash as a real segment. */
export function packagePath(name: string): string {
  return `/npm/${name.split("/").map(encodeURIComponent).join("/")}`;
}
