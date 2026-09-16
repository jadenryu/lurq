import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
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
  // Checks are carried through, and this route is the reason that matters: it
  // sits between the dashboard and the backend, so rebuilding a three-key
  // policy here strips a granted check in transit — the save succeeds, the
  // toggle looks like it worked, and nothing runs. Fixing the backend's parser
  // alone does not close that, because this one gets the request first.
  const checks = parseChecks(raw.checks);
  // Carried for the same reason as `checks`: this route is upstream of the
  // backend's parser, so a mode dropped here never reaches it and the user's
  // choice is lost in transit with a successful-looking save.
  const mode =
    raw.mode === "comment" || raw.mode === "fix" || raw.mode === "pr" ? raw.mode : null;
  return {
    enabled: raw.enabled,
    scope: raw.scope,
    autoMerge: raw.autoMerge,
    ...(checks ? { checks } : {}),
    ...(mode ? { mode } : {}),
  };
}

/** Absent or malformed reads as not granted. An explicit false and a missing
 *  key mean the same thing, so only a granted check is forwarded. */
function parseChecks(input: unknown): RepoPolicy["checks"] | null {
  if (!input || typeof input !== "object") return null;
  return { env: (input as Record<string, unknown>).env === true };
}

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
