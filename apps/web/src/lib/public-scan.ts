/**
 * The public scan, fetched server-side for the shareable report page.
 *
 * The hero box (components/site/repo-scan.tsx) calls /api/scan from the browser
 * because it is answering a keystroke. This path is for /scan/[owner]/[repo],
 * which is a URL somebody pasted into Slack: it has to render on the server so
 * the numbers are in the HTML, so the social card can read them, and so a
 * crawler sees a page rather than a spinner.
 *
 * Both hops land on the same backend `/scan/public`, which caches by target.
 * The page and its opengraph-image therefore cost one scan between them, not
 * two, and a link that gets passed around costs one for everybody.
 */
import "server-only";

export { FREE_DEPS } from "./scan-limits";

/** One dependency row. Mirrors `ScanDep` on the API (src/github/publicScan.ts). */
export interface ScanDep {
  name: string;
  range: string;
  resolved: string | null;
  latest: string | null;
  majorsBehind: number;
  deprecated: boolean;
  advisories: number;
}

/** One peer/engine conflict the repo would hit if it took every upgrade. */
export interface ScanConflict {
  source: "peer-deps" | "engines" | "sandbox" | "resolve";
  packages: string[];
  detail: string;
}

export interface PublicScan {
  repo: string;
  url: string;
  depsDeclared: number;
  depsTracked: number;
  majorDrift: number;
  anyDrift: number;
  deprecated: number;
  advisories: number;
  conflicts: number;
  deps: ScanDep[];
  conflictDetail: ScanConflict[];
  partial: boolean;
}


/**
 * Scan a repo for the report page. `null` means no readable public manifest,
 * which the page renders as a 404 rather than as an error.
 *
 * Never throws: a report page that 500s on a cold backend is a dead share link,
 * and "could not read this" is a page a visitor can act on.
 */
export async function scanRepo(owner: string, repo: string): Promise<PublicScan | null> {
  const base = process.env.LURQ_MCP_URL;
  if (!base) return null;

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/scan/public`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: `${owner}/${repo}` }),
      signal: AbortSignal.timeout(20_000),
      // The backend holds its own TTL'd cache keyed by target and knows when a
      // repo was unreadable-but-queued. Caching again here would only add a
      // second, dumber clock that cannot tell those apart.
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicScan;
  } catch {
    return null;
  }
}

/** The one sentence a social card and a meta description can both carry. */
export function scanHeadline(scan: PublicScan): string {
  if (scan.depsTracked === 0) return "No indexed dependencies in the root manifest yet.";
  const parts: string[] = [`${scan.depsTracked} dependencies read`];
  if (scan.majorDrift > 0) parts.push(`${scan.majorDrift} a major behind`);
  if (scan.advisories > 0) parts.push(`${scan.advisories} with advisories`);
  if (scan.conflicts > 0) parts.push(`${scan.conflicts} conflicts at latest`);
  return `${parts.join(", ")}.`;
}
