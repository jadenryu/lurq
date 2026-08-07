import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isDemoUser } from "@/lib/demo-data";
import {
  disconnectRepo,
  updateRepoPolicy,
  LurqIssuerError,
  type RepoPolicy,
} from "@/lib/lurq-issuer";

/**
 * A policy is a permission grant, so it is validated here as well as in the
 * backend. Rejecting a partial object rather than merging it means a malformed
 * request can never arm a repo the user meant to leave off.
 */
function parsePolicy(input: unknown): RepoPolicy | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.enabled !== "boolean" || typeof raw.autoMerge !== "boolean") return null;
  if (raw.scope !== "security" && raw.scope !== "blocking" && raw.scope !== "all") return null;
  return { enabled: raw.enabled, scope: raw.scope, autoMerge: raw.autoMerge };
}

async function guard(id: string): Promise<
  { ok: true; userId: string; repoId: number } | { ok: false; response: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  }
  if (await isDemoUser(userId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not available on demo data." }, { status: 409 }),
    };
  }
  const repoId = Number(id);
  if (!Number.isInteger(repoId)) {
    return { ok: false, response: NextResponse.json({ error: "Bad repo id." }, { status: 400 }) };
  }
  return { ok: true, userId, repoId };
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
    await updateRepoPolicy(checked.userId, checked.repoId, policy);
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
    await disconnectRepo(checked.userId, checked.repoId);
    return NextResponse.json({ removed: true });
  } catch (err) {
    return failure(err);
  }
}
