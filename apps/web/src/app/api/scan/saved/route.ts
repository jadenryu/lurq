import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { fetchBuilderScans, LurqIssuerError } from "@/lib/lurq-issuer";

/** The account's saved builder reports, most recent first. */
export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Sign in to see saved scans." }, { status: 401 });
  }
  try {
    return NextResponse.json(
      { scans: await fetchBuilderScans(owner.ownerId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not load saved scans." }, { status: 502 });
  }
}
