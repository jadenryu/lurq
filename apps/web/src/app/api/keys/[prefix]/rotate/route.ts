import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { rotateKeyByPrefix, LurqIssuerError } from "@/lib/lurq-issuer";

export async function POST(_req: Request, ctx: RouteContext<"/api/keys/[prefix]/rotate">) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to manage keys." }, { status: 401 });
  }

  const { prefix } = await ctx.params;
  try {
    const rotated = await rotateKeyByPrefix(userId, prefix);
    if (!rotated) {
      return NextResponse.json({ error: "Key not found." }, { status: 404 });
    }
    return NextResponse.json(rotated);
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Key service unreachable." }, { status: 502 });
  }
}
