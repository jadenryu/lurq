import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import { dispatchRepoRun, LurqIssuerError } from "@/lib/lurq-issuer";

/**
 * Start this repository's upgrade workflow now, rather than at the next cron.
 *
 * The outcomes are not errors: a repo that is not armed, or whose workflow was
 * never committed, is a correctly-working system in a state the user has to be
 * told about by name. Only an unreachable issuer is a 5xx.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/repos/[id]/dispatch">) {
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (await isDemoUser(owner.userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Bad repository id." }, { status: 400 });
  }
  try {
    return NextResponse.json({ outcome: await dispatchRepoRun(owner.ownerId, id) });
  } catch (err) {
    const status = err instanceof LurqIssuerError ? err.status : 500;
    return NextResponse.json({ error: "Could not start a run." }, { status });
  }
}
