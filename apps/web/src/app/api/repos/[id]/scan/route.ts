import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isDemoUser } from "@/lib/demo-data";
import { scanRepo, LurqIssuerError } from "@/lib/lurq-issuer";

export async function POST(_req: Request, ctx: RouteContext<"/api/repos/[id]/scan">) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (await isDemoUser(userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }

  const repoId = Number((await ctx.params).id);
  if (!Number.isInteger(repoId)) {
    return NextResponse.json({ error: "Bad repo id." }, { status: 400 });
  }

  try {
    await scanRepo(userId, repoId);
    return NextResponse.json({ scanned: true });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Repo service unreachable." }, { status: 502 });
  }
}
