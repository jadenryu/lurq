import { NextResponse } from "next/server";
import { ADMIN_ONLY, currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import { rotateKeyByPrefix, LurqIssuerError } from "@/lib/lurq-issuer";

export async function POST(_req: Request, ctx: RouteContext<"/api/keys/[prefix]/rotate">) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Sign in to manage keys." }, { status: 401 });
  }

  // Demo fixtures aren't real rows in api_keys, so there is nothing to rotate.
  // The keys table is read-only in demo mode, so this is belt-and-braces for a
  // hand-crafted request rather than a reachable UI path.
  if (await isDemoUser(owner.userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }

  if (!owner.canManage) {

    return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });

  }


  const { prefix } = await ctx.params;
  try {
    const rotated = await rotateKeyByPrefix(owner.ownerId, prefix);
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
