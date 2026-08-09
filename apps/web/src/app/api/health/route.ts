/**
 * Proxy for the hosted server's health check.
 *
 * The footer status dot has to reflect something real, and calling
 * `api.lurq.run/healthz` from the browser would depend on that origin sending
 * CORS headers. Asking server-side removes that coupling: this route is the only
 * thing the page needs to reach, and it reports exactly what upstream said.
 *
 * Never cached: a cached health check is a decoration.
 */
import { HEALTH_ENDPOINT } from "@/lib/marketing-copy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const started = Date.now();
  try {
    const res = await fetch(HEALTH_ENDPOINT, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return Response.json(
      {
        ok: res.ok && body?.status === "ok",
        upstream: res.status,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        upstream: null,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
