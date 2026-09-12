import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * The landing page's scan box, forwarded to the backend's public scan.
 *
 * Unauthenticated on purpose, and the only route here that is: it is the thing
 * a visitor does before they have an account. See src/mcp/http.ts `/scan/public`
 * for what it is allowed to return and why the result is capped.
 *
 * This hop exists rather than the browser calling api.lurq.run directly for two
 * reasons: the backend origin stays a server-side env var instead of a public
 * one, and there is no CORS preflight on every keystroke of a first impression.
 */
export const dynamic = "force-dynamic";

/**
 * Scans per IP per minute. Generous for a person, useless as a scan API.
 *
 * A courtesy layer, not the ceiling. lib/rate-limit counts in memory, so on a
 * serverless host each warm instance enforces this independently and the real
 * limit is 6 × however many are up. The authoritative one is `scanLimiter` on
 * the backend's /scan/public, which is Redis-backed when REDIS_URL is set and
 * therefore correct across instances. This exists to keep an obvious refresh
 * loop from crossing the network at all.
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

export async function POST(req: Request) {
  const base = process.env.LURQ_MCP_URL;
  if (!base) {
    return NextResponse.json({ error: "Scanning isn't available right now." }, { status: 503 });
  }

  const limit = checkRateLimit(`scan:${clientIp(req)}`, PER_MINUTE);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "That's a lot of scans. Give it a minute." },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { target?: unknown };
  const target = typeof body.target === "string" ? body.target.slice(0, 200) : "";
  if (!target.trim()) {
    return NextResponse.json({ error: "Enter a repo or a GitHub username." }, { status: 400 });
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/scan/public`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
      // A scan reads GitHub and then the index. Longer than a page load should
      // ever take, short enough that a hung origin does not hold the box open.
      signal: AbortSignal.timeout(20_000),
    });

    /**
     * A NON-JSON BODY IS A SERVICE PROBLEM, NEVER A REPO PROBLEM.
     *
     * This used to fall back to "Could not read that repository." on any parse
     * failure, and it cost an afternoon. An older build of the API does not
     * have /scan/public at all, so Express answers with its own HTML 404 page;
     * the parse failed, the fallback fired, and the landing page told everyone
     * who tried it that their perfectly good repository could not be read. The
     * one message the user could act on was the one thing that was not wrong.
     *
     * Anything that is not JSON means the request never reached the scanner,
     * and it has to say so.
     */
    const body = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      console.error(`scan: ${res.status} from ${base} with a non-JSON body`);
      return NextResponse.json(
        { error: "Scanning is not available on this deployment yet." },
        { status: 502 },
      );
    }

    return NextResponse.json(data, {
      status: res.status,
      headers: forwardedLimitHeaders(res),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the index." }, { status: 502 });
  }
}
