import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { LurqIssuerError, openBillingPortal } from "@/lib/lurq-issuer";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Open Stripe's own subscription-management UI for the signed-in user.
 *
 * Everything a customer can do to their own plan — change card, change tier,
 * cancel, read invoices — happens in Stripe's portal rather than in a screen
 * here. That is a deliberate choice about scope: those flows are where billing
 * bugs live, Stripe already handles proration, tax and dunning correctly, and
 * re-implementing them buys nothing a customer would notice.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to manage billing." }, { status: 401 });
  }

  if (!rateLimit(`billing:portal:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  try {
    const url = await openBillingPortal(userId);
    if (!url) {
      return NextResponse.json({ error: "You don't have a paid plan yet." }, { status: 404 });
    }
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not open the billing portal." }, { status: 502 });
  }
}
