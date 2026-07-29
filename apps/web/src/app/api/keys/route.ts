import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchKeys, issueKey, LurqIssuerError } from "@/lib/lurq-issuer";

/**
 * Self-serve API-key issuance/listing. Clerk authenticates the user here;
 * `ownerId` is always the individual Clerk user id (no org concept — one
 * identity per account). The backend never sees Clerk — it trusts this route
 * via the shared LURQ_ISSUER_SECRET. Plaintext keys are returned to the client
 * exactly once, at creation, and never stored here.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view your keys." }, { status: 401 });
  }
  try {
    const keys = await fetchKeys(userId);
    return NextResponse.json({ keys });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to generate a key." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label.slice(0, 200) : undefined;

  try {
    const { key, prefix } = await issueKey({ ownerId: userId, label });
    return NextResponse.json({ key, prefix });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
