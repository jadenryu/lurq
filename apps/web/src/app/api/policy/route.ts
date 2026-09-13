import { NextResponse } from "next/server";
import { ADMIN_ONLY, currentOwner } from "@/lib/owner";
import { isDemoUser } from "@/lib/demo-data";
import {
  fetchSelectionPolicy,
  updateSelectionPolicy,
  LurqIssuerError,
  type SelectionPolicy,
} from "@/lib/lurq-issuer";

const CONFIDENCES = ["unproven", "promising", "emerging", "proven"] as const;
const SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;
const MAX_ENTRIES = 500;
const MAX_LEN = 214;

/** Same ceilings the backend parser enforces; see src/policy/parse.ts. */
const LIMITS = {
  minWeeklyDownloads: { min: 0, max: 100_000_000 },
  maxStaleMonths: { min: 1, max: 240 },
  maxBundleKb: { min: 1, max: 100_000 },
  minPackageAgeDays: { min: 1, max: 365 },
} as const;

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

  // Exceptions carry a reason and an expiry when set from a policy file. Both are
  // kept on the way through: dropping them on a dashboard save would turn an
  // expiring exception into a permanent one without anyone deciding that.
  if (!Array.isArray(raw.allow) || raw.allow.length > MAX_ENTRIES) return null;
  const allow: SelectionPolicy["allow"] = [];
  for (const item of raw.allow) {
    // A bare name is what this form sent before exceptions had those fields.
    const entry = typeof item === "string" ? { name: item } : item;
    if (!entry || typeof entry !== "object") return null;
    const rule = entry as Record<string, unknown>;
    if (typeof rule.name !== "string") return null;
    const name = rule.name.trim();
    if (!name || name.length > MAX_LEN) return null;
    const out: SelectionPolicy["allow"][number] = { name };
    if (rule.reason != null) {
      if (typeof rule.reason !== "string" || rule.reason.length > MAX_LEN) return null;
      if (rule.reason.trim()) out.reason = rule.reason.trim();
    }
    if (rule.expires != null) {
      if (typeof rule.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rule.expires)) return null;
      out.expires = rule.expires;
    }
    allow.push(out);
  }

  // Same reasoning as the other late fields: absent means the pre-existing
  // behaviour (enforce), and anything else is rejected rather than guessed.
  if (raw.mode !== undefined && raw.mode !== "enforce" && raw.mode !== "warn") return null;

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

  // Bounded, finite, or null for "no rule". Rejected rather than clamped: a
  // clamp saves a rule other than the one the form sent.
  const bounded = (
    value: unknown,
    limit: { min: number; max: number },
  ): number | null | false => {
    if (value == null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (value < limit.min || value > limit.max) return false;
    return value;
  };

  if (raw.blockArchived !== undefined && typeof raw.blockArchived !== "boolean") return null;

  let maxAdvisorySeverity: SelectionPolicy["maxAdvisorySeverity"] = null;
  if (raw.maxAdvisorySeverity != null) {
    if (typeof raw.maxAdvisorySeverity !== "string") return null;
    if (!SEVERITIES.includes(raw.maxAdvisorySeverity as (typeof SEVERITIES)[number])) return null;
    maxAdvisorySeverity = raw.maxAdvisorySeverity as SelectionPolicy["maxAdvisorySeverity"];
  }

  const minWeeklyDownloads = bounded(raw.minWeeklyDownloads, LIMITS.minWeeklyDownloads);
  if (minWeeklyDownloads === false) return null;
  const maxStaleMonths = bounded(raw.maxStaleMonths, LIMITS.maxStaleMonths);
  if (maxStaleMonths === false) return null;
  const maxBundleKb = bounded(raw.maxBundleKb, LIMITS.maxBundleKb);
  if (maxBundleKb === false) return null;
  const minPackageAgeDays = bounded(raw.minPackageAgeDays, LIMITS.minPackageAgeDays);
  if (minPackageAgeDays === false) return null;

  return {
    mode: raw.mode === "warn" ? "warn" : "enforce",
    allow,
    deny,
    minConfidence,
    licenses,
    blockDeprecated: raw.blockDeprecated,
    blockArchived: raw.blockArchived === true,
    maxAdvisorySeverity,
    minWeeklyDownloads,
    maxStaleMonths,
    maxBundleKb,
    minPackageAgeDays,
  };
}

function failure(err: unknown): NextResponse {
  if (err instanceof LurqIssuerError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Policy service unreachable." }, { status: 502 });
}

export async function GET() {
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    return NextResponse.json({ policy: await fetchSelectionPolicy(owner.ownerId) });
  } catch (err) {
    return failure(err);
  }
}

export async function PUT(req: Request) {
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (await isDemoUser(owner.userId)) {
    return NextResponse.json({ error: "Not available on demo data." }, { status: 409 });
  }

  if (!owner.canManage) {

    return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });

  }


  const body = (await req.json().catch(() => null)) as { policy?: unknown } | null;
  const policy = parsePolicy(body?.policy);
  if (!policy) {
    return NextResponse.json({ error: "A complete policy is required." }, { status: 400 });
  }

  try {
    await updateSelectionPolicy(owner.ownerId, policy);
    return NextResponse.json({ policy });
  } catch (err) {
    return failure(err);
  }
}
