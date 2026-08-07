/**
 * GitHub App post-install redirect target.
 *
 * GitHub sends the user here with `installation_id` and the `state` we signed
 * before the redirect. This route verifies both, hands the installation to the
 * backend, and bounces the user to the repos page — it never renders, so every
 * exit is a redirect carrying a status the page turns into a message.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { verifyState } from "@/lib/github-connect";
import { connectInstallation, LurqIssuerError } from "@/lib/lurq-issuer";

function back(req: NextRequest, status: string): NextResponse {
  return NextResponse.redirect(new URL(`/dashboard/repos?connect=${status}`, req.url));
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const params = req.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const installationId = Number(params.get("installation_id"));

  // A mismatched state is the forged-callback case (see lib/github-connect.ts),
  // not a user error — refuse it rather than connecting anything.
  if (!verifyState(state, userId)) return back(req, "invalid");
  if (!Number.isInteger(installationId) || installationId <= 0) return back(req, "invalid");

  try {
    const connected = await connectInstallation(userId, installationId);
    return back(req, connected > 0 ? "ok" : "empty");
  } catch (err) {
    console.warn(
      "[lurq] GitHub connect failed.",
      err instanceof LurqIssuerError ? err.message : String(err),
    );
    return back(req, "failed");
  }
}
