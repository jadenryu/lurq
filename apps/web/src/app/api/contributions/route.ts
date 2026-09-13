import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { fetchContributions, LurqIssuerError } from "@/lib/lurq-issuer";

export async function GET() {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Sign in to view contributions." }, { status: 401 });
  }
  try {
    const contributions = await fetchContributions(owner.ownerId);
    return NextResponse.json(contributions);
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
