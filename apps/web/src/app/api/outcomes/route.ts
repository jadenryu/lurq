import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { fetchOutcomes, LurqIssuerError } from "@/lib/lurq-issuer";

export async function GET() {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Sign in to view activity." }, { status: 401 });
  }
  try {
    const outcomes = await fetchOutcomes(owner.ownerId);
    return NextResponse.json({ outcomes });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
