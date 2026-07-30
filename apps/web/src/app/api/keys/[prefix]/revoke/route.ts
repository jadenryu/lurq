import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isDemoUser } from "@/lib/demo-data";
import { revokeKeyByPrefix, LurqIssuerError } from "@/lib/lurq-issuer";

export async function POST(_req: Request, ctx: RouteContext<"/api/keys/[prefix]/revoke">) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to manage keys." }, { status: 401 });
  }

  // Demo fixtures aren't real rows in api_keys, so there is nothing to revoke.
  // The keys table is read-only in demo mode, so this is belt-and-braces for a
  // hand-crafted request rather than a reachable UI path.
  if (await isDemoUser(userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }

  const { prefix } = await ctx.params;
  try {
    const revoked = await revokeKeyByPrefix(userId, prefix);
    if (!revoked) {
      return NextResponse.json({ error: "Key not found." }, { status: 404 });
    }
    return NextResponse.json({ revoked: true });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
