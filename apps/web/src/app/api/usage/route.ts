import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchUsage, LurqIssuerError } from "@/lib/lurq-issuer";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view usage." }, { status: 401 });
  }
  try {
    const usage = await fetchUsage(userId);
    return NextResponse.json(usage);
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
