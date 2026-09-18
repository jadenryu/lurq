import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import { parseRepoPolicy } from "@lurq/core/repoPolicy";
import { applyPolicyToRepos, LurqIssuerError } from "@/lib/lurq-issuer";

/**
 * Apply one policy to a selection of repositories.
 *
 * Ids, not a filter: the table already evaluated the filter and the user
 * confirmed the rows. Re-deriving "everything matching what was on screen" here
 * would let the two evaluations disagree between the click and the write, and
 * this endpoint changes permissions.
 */
export async function PATCH(req: Request) {
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (await isDemoUser(owner.userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as {
    ids?: unknown;
    policy?: unknown;
  } | null;
  const policy = parseRepoPolicy(body?.policy);
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is number => Number.isInteger(id))
    : [];
  if (!policy || ids.length === 0) {
    return NextResponse.json(
      { error: "A complete policy and at least one repository are required." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ applied: await applyPolicyToRepos(owner.ownerId, ids, policy) });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Repo service unreachable." }, { status: 502 });
  }
}
