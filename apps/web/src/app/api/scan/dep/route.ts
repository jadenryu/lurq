import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/owner";
import { callAskTool } from "@/lib/lurq-issuer";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import type { DepAdvisory, DepDetail, DepDiff } from "@/lib/builder-profile";

/**
 * One dependency from the builder report, opened: what changed between the
 * version a repo resolves and the latest (`diff_surface`), and its advisories
 * and deprecation (`evaluate`). The report itself only carries counts.
 *
 * Signed in only: each lookup is a tool call on the account, under the same
 * monthly allowance the backend enforces for every other call. Only the sides a
 * row needs are run, so a row that is only a major behind costs one call.
 */
export const dynamic = "force-dynamic";

/** Opens per account per minute. A person clicking through a report stays well under it. */
const PER_MINUTE = 20;
const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const VERSION = /^[\w.+-]{1,64}$/;

type ToolResult = { isError: boolean; text: string };

function parse<T>(result: ToolResult): T | null {
  if (result.isError) return null;
  try {
    return JSON.parse(result.text) as T;
  } catch {
    return null;
  }
}

/** A tool's error text is written for a model; keep it short for a person. */
function why(result: ToolResult, fallback: string): string {
  return result.isError && result.text ? result.text.slice(0, 300) : fallback;
}

export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Sign in to open a dependency." }, { status: 401 });
  }

  const limit = checkRateLimit(`scan-dep:${owner.ownerId}`, PER_MINUTE);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "That's a lot of lookups. Give it a minute." },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const pkg = typeof body.package === "string" ? body.package : "";
  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";
  const wantDiff = Boolean(from && to && from !== to);
  const wantEvaluate = body.evaluate === true;
  if (
    pkg.length > 214 ||
    !NPM_NAME.test(pkg) ||
    (wantDiff && !(VERSION.test(from) && VERSION.test(to))) ||
    (!wantDiff && !wantEvaluate)
  ) {
    return NextResponse.json(
      { error: "Give a package name, and two versions to compare or evaluate: true." },
      { status: 400 },
    );
  }

  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
    callAskTool(owner.ownerId, name, args).catch(() => ({ isError: true, text: "" }));

  const [diffResult, evaluateResult] = await Promise.all([
    wantDiff ? call("diff_surface", { package: pkg, fromVersion: from, toVersion: to }) : null,
    wantEvaluate ? call("evaluate", { package: pkg }) : null,
  ]);

  const detail: DepDetail = { diff: null, advisories: null, deprecated: null, reasons: [], unavailable: [] };

  if (diffResult) {
    const d = parse<Partial<DepDiff>>(diffResult);
    if (d) {
      detail.diff = {
        fromVersion: from,
        toVersion: to,
        verdict: String(d.verdict ?? "unknown"),
        ...(d.inconclusive ? { inconclusive: d.inconclusive } : {}),
        removed: d.removed ?? [],
        renamed: d.renamed ?? [],
        arityChanged: d.arityChanged ?? [],
        typeOnlyRemoved: d.typeOnlyRemoved ?? [],
        deprecated: d.deprecated ?? [],
      };
    } else {
      detail.unavailable.push(why(diffResult, `Could not compare ${from} with ${to} right now.`));
    }
  }

  if (evaluateResult) {
    const e = parse<{
      advisories?: DepAdvisory[] | null;
      deprecated?: boolean | string;
      verdict?: { reasons?: string[] };
    }>(evaluateResult);
    if (e) {
      detail.advisories = e.advisories ?? null;
      detail.deprecated = e.deprecated ?? false;
      detail.reasons = e.verdict?.reasons ?? [];
    } else {
      detail.unavailable.push(why(evaluateResult, `Could not read ${pkg}'s advisories right now.`));
    }
  }

  return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
}
