import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import { parseRepoPolicy } from "@lurq/core/repoPolicy";
import { saveRepoPolicyDefault, LurqIssuerError } from "@/lib/lurq-issuer";

/**
 * The account-wide autopilot default, and the one action that stamps it onto
 * every connected repo.
 *
 * Both in one call on purpose. As two endpoints, "save" and "apply to all"
 * leave a gap where the stamp applies a policy the user has since edited on
 * screen, and the UI has to decide which one wins. A flag on the save has no
 * such gap.
 */
export async function PUT(req: Request) {
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (await isDemoUser(owner.userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as {
    policy?: unknown;
    applyToAll?: unknown;
  } | null;
  const policy = parseRepoPolicy(body?.policy);
  if (!policy) {
    return NextResponse.json({ error: "A complete policy is required." }, { status: 400 });
  }

  try {
    const applied = await saveRepoPolicyDefault(owner.ownerId, policy, body?.applyToAll === true);
    return NextResponse.json({ policy, applied });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Repo service unreachable." }, { status: 502 });
  }
}
