import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { FREE_DEPS, type BuilderProfile, type BuilderReport } from "@/lib/builder-profile";
import { fetchBuilderScan, saveBuilderScan } from "@/lib/lurq-issuer";
import { currentOwner } from "@/lib/owner";

/**
 * The builder report's data, forwarded from the backend's profile scan.
 *
 * Unauthenticated on purpose: /dashboard/report calls it for a visitor the
 * landing page's scan box sent over before they had an account. See
 * src/mcp/http.ts `/scan/profile` for what the backend computes and caches.
 *
 * This hop exists rather than the browser calling api.lurq.run directly for
 * three reasons: the backend origin stays a server-side env var, there is no
 * CORS preflight on a first impression, and it is where the session is known,
 * so it is where the signed-out cut is made.
 */
export const dynamic = "force-dynamic";

/**
 * Scans per IP per minute. Generous for a person, useless as a scan API.
 *
 * A courtesy layer, not the ceiling. lib/rate-limit counts in memory, so on a
 * serverless host each warm instance enforces this independently and the real
 * limit is 6 × however many are up. The authoritative one is `scanLimiter` on
 * the backend, which is Redis-backed when REDIS_URL is set and therefore
 * correct across instances. This exists to keep an obvious refresh loop from
 * crossing the network at all.
 */
const PER_MINUTE = 6;

/**
 * The backend's rate-limit verdict, passed through instead of swallowed.
 *
 * Its limiter is the authoritative one, so when it is the limiter that fired,
 * its headers are the ones that say when to come back. Without this the
 * browser got a bare 429 from a hop that had not limited anything.
 */
const RATE_LIMIT_HEADERS = [
  "retry-after",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "ratelimit-policy",
] as const;

function forwardedLimitHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of RATE_LIMIT_HEADERS) {
    const value = res.headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  // Left-most entry is the client; the rest are the proxies it passed through.
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * The signed-out cut, made on the server.
 *
 * The old public report blurred real rows with CSS and accepted that devtools
 * defeats it, which was fine for eight dependency rows. This gate covers the
 * trait evidence and every other repo, so it is a real slice: a signed-out
 * browser receives exactly what it renders. What survives is the archetype
 * (the answer they came for) and the head of the first repo; the counts of what
 * was dropped survive too, because "5 more repos and 3 conflicts" is the ask.
 */
function forVisitor(profile: BuilderProfile): BuilderReport {
  const [first, ...rest] = profile.repos;
  return {
    ...profile,
    traits: null,
    repos: first ? [{ ...first, deps: first.deps.slice(0, FREE_DEPS), conflictDetail: [] }] : [],
    locked: {
      repos: rest.length,
      deps: first ? Math.max(0, first.deps.length - FREE_DEPS) : 0,
      conflicts: first?.conflictDetail.length ?? 0,
    },
  };
}

export async function POST(req: Request) {
  const base = process.env.LURQ_MCP_URL;
  if (!base) {
    return NextResponse.json({ error: "Scanning isn't available right now." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { target?: unknown; fresh?: unknown };
  const target = typeof body.target === "string" ? body.target.slice(0, 200) : "";
  if (!target.trim()) {
    return NextResponse.json({ error: "Enter a GitHub username or repo." }, { status: 400 });
  }

  /**
   * SIGNED IN, A REPORT OPENED AGAIN IS THE SAVED ONE.
   *
   * No GitHub calls, no scan spent against the limit, and the numbers they saw
   * last time rather than a quietly different set. "Scan again" sends `fresh`.
   * A failed lookup (an API without the route, issuer not configured) falls
   * through to a live scan: saving is a convenience and must never cost someone
   * the report itself.
   */
  const owner = await currentOwner();
  if (owner && body.fresh !== true) {
    const saved = await fetchBuilderScan(owner.ownerId, target).catch(() => null);
    if (saved) {
      const report: BuilderReport = { ...saved.profile, locked: null, savedAt: saved.scannedAt };
      return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
    }
  }

  const limit = checkRateLimit(`scan:${clientIp(req)}`, PER_MINUTE);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "That's a lot of scans. Give it a minute." },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/scan/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
      // Reads GitHub, several manifests, then the index. Longer than a page
      // load should take, short enough that a hung origin does not hold the
      // report open.
      signal: AbortSignal.timeout(25_000),
    });

    /**
     * A NON-JSON BODY IS A SERVICE PROBLEM, NEVER A PROFILE PROBLEM.
     *
     * This used to fall back to "Could not read that repository." on any parse
     * failure, and it cost an afternoon: an older API build without the route
     * answers with Express's HTML 404, and the page told everyone their
     * perfectly good repository could not be read. Anything that is not JSON
     * means the request never reached the scanner, and it has to say so.
     */
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      console.error(`scan: ${res.status} from ${base} with a non-JSON body`);
      return NextResponse.json(
        { error: "Scanning is not available on this deployment yet." },
        { status: 502 },
      );
    }

    const headers = { ...forwardedLimitHeaders(res), "Cache-Control": "private, no-store" };
    if (!res.ok) return NextResponse.json(data, { status: res.status, headers });

    const profile = data as BuilderProfile;
    if (!owner) return NextResponse.json(forVisitor(profile), { headers });

    // Saved before answering, so the report can say it is saved. Never fatal,
    // for the reason the saved lookup above gives.
    const savedAt = await saveBuilderScan(owner.ownerId, target, profile).catch((err: unknown) => {
      console.error("scan: could not save the report:", err instanceof Error ? err.message : String(err));
      return null;
    });
    const report: BuilderReport = { ...profile, locked: null, savedAt };
    return NextResponse.json(report, { headers });
  } catch {
    return NextResponse.json({ error: "Could not reach the index." }, { status: 502 });
  }
}
