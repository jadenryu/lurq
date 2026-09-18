import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import { parsePolicy } from "@/lib/parse-policy";
import {
  disconnectRepo,
  updateRepoPolicy,
  LurqIssuerError,
} from "@/lib/lurq-issuer";

async function guard(id: string): Promise<
  { ok: true; ownerId: string; repoId: number } | { ok: false; response: NextResponse }
> {
  const owner = await currentOwner();
  if (!owner) {
    return { ok: false, response: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  }
  if (await isDemoUser(owner.userId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not available on demo data." }, { status: 409 }),
    };
  }
  const repoId = Number(id);
  if (!Number.isInteger(repoId)) {
    return { ok: false, response: NextResponse.json({ error: "Bad repo id." }, { status: 400 }) };
  }
  return { ok: true, ownerId: owner.ownerId, repoId };
}

function failure(err: unknown): NextResponse {
  if (err instanceof LurqIssuerError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Repo service unreachable." }, { status: 502 });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/repos/[id]">) {
  const { id } = await ctx.params;
  const checked = await guard(id);
  if (!checked.ok) return checked.response;

  const body = (await req.json().catch(() => null)) as { policy?: unknown } | null;
  const policy = parsePolicy(body?.policy);
  if (!policy) {
    return NextResponse.json({ error: "A complete policy is required." }, { status: 400 });
  }

  try {
    await updateRepoPolicy(checked.ownerId, checked.repoId, policy);
    return NextResponse.json({ policy });
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/repos/[id]">) {
  const { id } = await ctx.params;
  const checked = await guard(id);
  if (!checked.ok) return checked.response;
  try {
    await disconnectRepo(checked.ownerId, checked.repoId);
    return NextResponse.json({ removed: true });
  } catch (err) {
    return failure(err);
  }
}
