import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { ADMIN_ONLY, currentOwner } from "@/lib/owner";
import { LurqIssuerError, startCheckout } from "@/lib/lurq-issuer";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { PLANS, type Tier } from "@lurq/core/plans";

/**
 * Start a Stripe Checkout for the signed-in user and hand back the URL.
 *
 * Clerk authenticates here and `ownerId` is the active owner (lib/owner.ts), exactly as
 * in /api/keys. The tier is validated against the shared plan table rather than
 * trusted from the body: without that, a crafted POST asking for a tier with a
 * cheaper Price attached would be honoured. The Price itself is chosen on the
 * backend from its own config, so the browser never names an amount.
 *
 * Nothing here grants anything. The response is a redirect target; entitlement
 * is written by the Stripe webhook against the MCP service.
 */
export async function POST(request: Request) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  // The plan belongs to the whole organization, so only an admin may buy or change it.
  if (!owner.canManage) {
    return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });
  }

  // Checkout session creation is a Stripe API call per request. Throttle it so a
  // stuck client cannot turn a double-click into a rate-limit problem upstream.
  const limit = checkRateLimit(`billing:checkout:${owner.ownerId}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  let tier: Tier = "pro";
  let interval: "month" | "year" = "month";
  // Where the buyer started, so backing out of Stripe returns them there.
  let from: "dashboard" | "pricing" = "pricing";
  try {
    const body = (await request.json()) as { tier?: string; interval?: string; from?: string };
    if (typeof body.tier === "string") tier = body.tier as Tier;
    if (body.interval === "year") interval = "year";
    if (body.from === "dashboard") from = "dashboard";
  } catch {
    // No body is fine: Pro is the cheapest self-serve plan, so it is the default.
    // Seats are not taken here; Stripe's form collects them for per-seat plans.
  }

  const plan = PLANS[tier];
  if (!plan?.paid || plan.contactOnly) {
    return NextResponse.json(
      { error: "That plan isn't available for self-serve checkout." },
      { status: 400 },
    );
  }

  // Team's seats are an organization's members, so a personal account has
  // nothing to count them against. Refused here rather than sold unenforceable.
  if (plan.perSeat && !owner.orgId) {
    return NextResponse.json(
      {
        error:
          "Team is bought for an organization. Create one from the account switcher in the dashboard sidebar, switch to it, then upgrade.",
      },
      { status: 400 },
    );
  }

  try {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;
    const url = await startCheckout({ ownerId: owner.ownerId, tier, interval, email, from });
    if (!url) {
      // Billing not configured, or no Price for this tier yet. Not the buyer's
      // problem and not an error state worth alarming them with.
      return NextResponse.json(
        { error: "Checkout isn't available yet.", contact: true },
        { status: 503 },
      );
    }
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not start checkout." }, { status: 502 });
  }
}
