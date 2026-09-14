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
  /** Absent from an API older than upgrade pages. */
  upgrades?: PublicUpgradePair[];
  dataAsOf: string | null;
}

/** Mirrors src/mcp/publicUpgrades.ts; the reasoning for what is served is there. */
export interface PublicUpgradePair {
  fromMajor: number;
  toMajor: number;
  fromVersion: string;
  toVersion: string;
  ready: boolean;
}

export type UpgradeVerdict = "removes-exports" | "arity-changed" | "types-only" | "clean" | "unknown";

export interface PublicUpgrade {
  package: string;
  pair: PublicUpgradePair;
  status: "ready" | "pending";
  verdict: UpgradeVerdict;
  removed: { path: string; kind: string }[];
  renamed: { path: string; to: string[] }[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
  typeOnlyRemoved: string[];
  deprecated: string[];
  added: number;
  truncated: boolean;
  tier: string | null;
  inconclusive: string | null;
  observedAt: string | null;
}

export const PACKAGE_REVALIDATE = 86_400;

/** Hourly: a pending page fills in when the worker extracts it, and should not wait a day to show that. */
export const UPGRADE_REVALIDATE = 3_600;

function apiBase(): string | null {
  const base = process.env.LURQ_MCP_URL;
  return base ? base.replace(/\/$/, "") : null;
}

/**
 * null ONLY when the API says the package has no public summary (404).
 *
 * Anything else throws. A page that turned "API unreachable" into notFound()
 * would be cached as a 404 for the whole revalidate window; throwing instead
 * leaves the last good page in place, or renders an error that is not cached.
 */
export async function fetchPublicPackage(name: string): Promise<PublicPackageSummary | null> {
  const base = apiBase();
  if (!base) throw new Error("LURQ_MCP_URL is not set; package pages cannot load.");
  const res = await fetch(`${base}/public/package?name=${encodeURIComponent(name)}`, {
    next: { revalidate: PACKAGE_REVALIDATE },
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`public package read failed with HTTP ${res.status}`);
  return (await res.json()) as PublicPackageSummary;
}

/** The public set, most-downloaded first. Empty when the API is unreachable. */
export async function fetchPublicPackageList(): Promise<{ name: string; dataAsOf: string | null }[]> {
  const base = apiBase();
  if (!base) return [];
  try {
    // no-store: only the per-request sitemap reads this, and a cached empty list
    // is exactly the failure that sitemap.ts was changed to stop.
    const res = await fetch(`${base}/public/packages`, { cache: "no-store" });
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

export function upgradePath(name: string, fromMajor: number, toMajor: number): string {
  return `${packagePath(name)}/${fromMajor}-to-${toMajor}`;
}

/**
 * What an /npm/... path means: a package, or an upgrade page for one.
 *
 * The last segment reads as an upgrade only when what precedes it is a whole
 * package name. `@scope/1-to-2` is a scoped package whose name happens to look
 * like a jump, not an upgrade of the bare scope.
 */
export function parseNpmPath(
  segments: string[],
): { kind: "package"; name: string } | { kind: "upgrade"; name: string; from: number; to: number } {
  const parts = segments.map((s) => decodeURIComponent(s));
  const jump = /^(\d{1,6})-to-(\d{1,6})$/.exec(parts.at(-1) ?? "");
  const rest = parts.slice(0, -1);
  if (jump && rest.length > 0 && !(rest.length === 1 && rest[0]!.startsWith("@"))) {
    const from = Number(jump[1]);
    const to = Number(jump[2]);
    if (to > from) return { kind: "upgrade", name: rest.join("/"), from, to };
  }
  return { kind: "package", name: parts.join("/") };
}

/** null when the API has no page for that jump (404/400). Other failures throw, like fetchPublicPackage. */
export async function fetchPublicUpgrade(name: string, from: number, to: number): Promise<PublicUpgrade | null> {
  const base = apiBase();
  if (!base) throw new Error("LURQ_MCP_URL is not set; upgrade pages cannot load.");
  const qs = new URLSearchParams({ name, from: String(from), to: String(to) });
  const res = await fetch(`${base}/public/upgrade?${qs.toString()}`, { next: { revalidate: UPGRADE_REVALIDATE } });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`public upgrade read failed with HTTP ${res.status}`);
  return (await res.json()) as PublicUpgrade;
}

/** Every ready upgrade page, for the sitemap. Empty when the API is unreachable. */
export async function fetchPublicUpgradeIndex(): Promise<{ package: string; pairs: PublicUpgradePair[] }[]> {
  const base = apiBase();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/public/upgrades`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { upgrades?: { package: string; pairs: PublicUpgradePair[] }[] };
    return data.upgrades ?? [];
  } catch {
    return [];
  }
}
