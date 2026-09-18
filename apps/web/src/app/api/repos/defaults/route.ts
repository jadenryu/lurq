import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import { parseRepoPolicy } from "@lurq/core/repoPolicy";
import { saveRepoPolicyDefault, LurqIssuerError } from "@/lib/lurq-issuer";

/**
 * The autopilot policy a repository gets when it is connected.
 *
 * Only future repositories: changing settings on repositories that already
 * exist happens in the table, where the user selects which ones and sees the
 * count before saving.
 */
export async function PUT(req: Request) {
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (await isDemoUser(owner.userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { policy?: unknown } | null;
  const policy = parseRepoPolicy(body?.policy);
  if (!policy) {
    return NextResponse.json({ error: "A complete policy is required." }, { status: 400 });
  }

  try {
    await saveRepoPolicyDefault(owner.ownerId, policy);
    return NextResponse.json({ policy });
  } catch (err) {
    if (err instanceof LurqIssuerError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Repo service unreachable." }, { status: 502 });
  }
}
