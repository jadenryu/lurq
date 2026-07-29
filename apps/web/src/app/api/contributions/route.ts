import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchContributions, LurqIssuerError } from "@/lib/lurq-issuer";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view contributions." }, { status: 401 });
  }
  try {
    const contributions = await fetchContributions(userId);
    return NextResponse.json(contributions);
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
