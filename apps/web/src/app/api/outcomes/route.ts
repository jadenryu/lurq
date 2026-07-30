import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchOutcomes, LurqIssuerError } from "@/lib/lurq-issuer";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view activity." }, { status: 401 });
  }
  try {
    const outcomes = await fetchOutcomes(userId);
    return NextResponse.json({ outcomes });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
