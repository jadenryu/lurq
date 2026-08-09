import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isDemoUser } from "@/lib/demo-data";
import {
  fetchSelectionPolicy,
  updateSelectionPolicy,
  LurqIssuerError,
  type SelectionPolicy,
} from "@/lib/lurq-issuer";

const CONFIDENCES = ["unproven", "promising", "emerging", "proven"] as const;
const MAX_ENTRIES = 500;
const MAX_LEN = 214;

/**
 * Validated here as well as in the backend, for the same reason `/api/repos/[id]`
 * duplicates its check: a policy is a permission grant, and rejecting a partial
 * object rather than merging it means a malformed request can never quietly drop
 * a rule. The failure mode of a silent merge is a denied package becoming
 * installable again, which nobody notices until it ships.
 */
function parsePolicy(input: unknown): SelectionPolicy | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const strings = (value: unknown): string[] | null => {
    if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null;
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== "string") return null;
      const trimmed = item.trim();
      if (!trimmed || trimmed.length > MAX_LEN) return null;
      out.push(trimmed);
    }
    return out;
  };

  const allow = strings(raw.allow);
  if (!allow) return null;

  if (!Array.isArray(raw.deny) || raw.deny.length > MAX_ENTRIES) return null;
  const deny: SelectionPolicy["deny"] = [];
  for (const item of raw.deny) {
    if (!item || typeof item !== "object") return null;
    const rule = item as Record<string, unknown>;
    if (typeof rule.name !== "string") return null;
    const name = rule.name.trim();
    if (!name || name.length > MAX_LEN) return null;
    if (rule.reason == null) {
      deny.push({ name });
      continue;
    }
    if (typeof rule.reason !== "string" || rule.reason.length > MAX_LEN) return null;
    const reason = rule.reason.trim();
    deny.push(reason ? { name, reason } : { name });
  }

  if (typeof raw.blockDeprecated !== "boolean") return null;

  let minConfidence: SelectionPolicy["minConfidence"] = null;
  if (raw.minConfidence != null) {
    if (typeof raw.minConfidence !== "string") return null;
    if (!CONFIDENCES.includes(raw.minConfidence as (typeof CONFIDENCES)[number])) return null;
    minConfidence = raw.minConfidence as SelectionPolicy["minConfidence"];
  }

  // `null` (no rule) and `[]` (an allowlist permitting nothing) are different
  // policies, so the null check precedes the array parse rather than folding in.
  let licenses: string[] | null = null;
  if (raw.licenses != null) {
    licenses = strings(raw.licenses);
    if (!licenses) return null;
  }

  return { allow, deny, minConfidence, licenses, blockDeprecated: raw.blockDeprecated };
}

function failure(err: unknown): NextResponse {
  if (err instanceof LurqIssuerError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Policy service unreachable." }, { status: 502 });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    return NextResponse.json({ policy: await fetchSelectionPolicy(userId) });
  } catch (err) {
    return failure(err);
  }
}

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (await isDemoUser(userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { policy?: unknown } | null;
  const policy = parsePolicy(body?.policy);
  if (!policy) {
    return NextResponse.json({ error: "A complete policy is required." }, { status: 400 });
  }

  try {
    await updateSelectionPolicy(userId, policy);
    return NextResponse.json({ policy });
  } catch (err) {
    return failure(err);
  }
}
