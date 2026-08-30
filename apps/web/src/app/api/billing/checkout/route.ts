import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { LurqIssuerError, startCheckout } from "@/lib/lurq-issuer";
import { rateLimit } from "@/lib/rate-limit";
import { PLANS, type Tier } from "@lurq/core/plans";

/**
 * Start a Stripe Checkout for the signed-in user and hand back the URL.
 *
 * Clerk authenticates here and `ownerId` is always the Clerk user id, exactly as
 * in /api/keys. The tier is validated against the shared plan table rather than
 * trusted from the body: without that, a crafted POST asking for a tier with a
 * cheaper Price attached would be honoured. The Price itself is chosen on the
 * backend from its own config, so the browser never names an amount.
 *
 * Nothing here grants anything. The response is a redirect target; entitlement
 * is written by the Stripe webhook against the MCP service.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  // Checkout session creation is a Stripe API call per request. Throttle it so a
  // stuck client cannot turn a double-click into a rate-limit problem upstream.
  if (!rateLimit(`billing:checkout:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let tier: Tier = "pro";
  try {
    const body = (await request.json()) as { tier?: string };
    if (typeof body.tier === "string") tier = body.tier as Tier;
  } catch {
    // No body is fine: Pro is the only self-serve plan, so it is the default.
  }

  const plan = PLANS[tier];
  if (!plan?.paid || plan.contactOnly) {
    return NextResponse.json(
      { error: "That plan isn't available for self-serve checkout." },
      { status: 400 },
    );
  }

  try {
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;
    const url = await startCheckout({ ownerId: userId, tier, email });
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
