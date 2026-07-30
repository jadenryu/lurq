/**
 * Seeded demo fixtures for designing the dashboard against realistic content.
 *
 * A pre-launch index has almost no per-user data, so every dashboard page renders
 * its empty state and the layout can't be judged. For the accounts listed in
 * `LURQ_DEMO_EMAILS` (default: the maintainer's), the pages substitute these
 * fixtures for the live reads.
 *
 * Strictly read-path and server-only. Nothing here writes to Postgres, nothing
 * here is reachable for a non-listed account, and the pages that use it render a
 * visible "demo data" chip so fixtures are never mistaken for real usage.
 * Never import this from a `"use client"` file.
 */
import { currentUser } from "@clerk/nextjs/server";
import type {
  DashboardContribution,
  DashboardKey,
  DashboardOutcome,
  DashboardUsage,
} from "@/lib/lurq-issuer";

const DEFAULT_DEMO_EMAILS = ["me.shivansh007@gmail.com"];

function csv(raw: string | undefined, fallback: string[]): string[] {
  const list = raw === undefined ? fallback : raw.split(",");
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Accounts that see fixtures. Set `LURQ_DEMO_EMAILS` to a comma-separated list to
 * override, or to an empty string to switch demo mode off entirely (e.g. in prod).
 */
function demoEmails(): string[] {
  return csv(process.env.LURQ_DEMO_EMAILS, DEFAULT_DEMO_EMAILS);
}

/**
 * Optional escape hatch: match on Clerk user ids instead of emails. The id comes
 * straight off the session with no Backend API call, so it can't be affected by a
 * Clerk outage or a missing secret key — worth pinning if email matching ever
 * behaves inconsistently.
 */
function demoUserIds(): string[] {
  return csv(process.env.LURQ_DEMO_USER_IDS, []);
}

/**
 * True when the signed-in account should see fixtures. Matches against *every*
 * address on the account, not just the primary one, so it works regardless of
 * which address Clerk considers primary.
 *
 * `userId` is checked first because it needs no network call. The email check
 * requires `currentUser()`, which hits Clerk's Backend API and therefore needs
 * `CLERK_SECRET_KEY`; if that call fails we log loudly rather than silently
 * deciding "not a demo user", because a silent false makes demo mode look flaky
 * (fixtures on one page, a live-data error on the next).
 */
export async function isDemoUser(userId?: string | null): Promise<boolean> {
  const ids = demoUserIds();
  if (userId && ids.includes(userId.toLowerCase())) return true;

  const allowed = demoEmails();
  if (allowed.length === 0) return false;
  try {
    const user = await currentUser();
    if (!user) return false;
    return user.emailAddresses.some((e) => allowed.includes(e.emailAddress.toLowerCase()));
  } catch (err) {
    console.warn(
      "[lurq] demo-mode email check failed; falling back to live data. " +
        "Set CLERK_SECRET_KEY, or pin LURQ_DEMO_USER_IDS to skip this call.",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

// ── deterministic generators ────────────────────────────────────────────────
// Fixtures are derived from the day index, not Math.random, so a refresh doesn't
// reshuffle the chart out from under a screenshot.

/** Stable 0..1 jitter for a given integer. */
function jitter(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** `YYYY-MM-DD`, `offset` days before today (UTC), matching the live series. */
function dayISO(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** ISO timestamp `hoursAgo` hours in the past. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/**
 * A believable 30-day call series: weekday plateau, weekend trough, one launch
 * spike, and a ramp-up over the first week (a real account that just started).
 */
function usageSeries(days: number): { date: string; count: number }[] {
  const out: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dayISO(i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const rampUp = Math.min(1, (days - i) / 6); // quiet first few days
    const base = weekend ? 34 : 128;
    const spread = weekend ? 22 : 70;
    let count = Math.round((base + jitter(i) * spread) * rampUp);
    if (i === 4) count = 317; // the spike a real dashboard has
    if (i === 12) count = 6; // an outage/quiet day, so the axis isn't monotone
    out.push({ date, count });
  }
  return out;
}

// ── fixtures ───────────────────────────────────────────────────────────────

export function demoUsage(days = 30): DashboardUsage {
  const series = usageSeries(days);
  const total = series.reduce((s, p) => s + p.count, 0);
  // Weights sum to ~1; last slot absorbs the rounding remainder.
  const mix: [string, number][] = [
    ["evaluate", 0.29],
    ["recommend", 0.23],
    ["verify", 0.17],
    ["compare", 0.11],
    ["compat", 0.08],
    ["plan", 0.06],
    ["usage", 0.04],
  ];
  const byTool = mix.map(([tool, w]) => ({ tool, count: Math.round(total * w) }));
  const assigned = byTool.reduce((s, t) => s + t.count, 0);
  byTool.push({ tool: "diagram", count: Math.max(0, total - assigned) });

  return {
    today: series[series.length - 1]?.count ?? 0,
    series,
    byTool: byTool.filter((t) => t.count > 0).sort((a, b) => b.count - a.count),
  };
}

export function demoKeys(): DashboardKey[] {
  return [
    {
      id: 3,
      prefix: "lurq_live_9f2c",
      label: "laptop",
      tier: "free",
      createdAt: dayISO(26),
      lastUsedAt: hoursAgo(2),
      revokedAt: null,
    },
    {
      id: 2,
      prefix: "lurq_live_4ab7",
      label: "CI",
      tier: "free",
      createdAt: dayISO(24),
      lastUsedAt: hoursAgo(19),
      revokedAt: null,
    },
    {
      id: 1,
      prefix: "lurq_live_1d08",
      label: "old laptop",
      tier: "free",
      createdAt: dayISO(29),
      lastUsedAt: dayISO(21),
      revokedAt: dayISO(20),
    },
  ];
}

/**
 * A simulated newly-issued key, so the create → reveal → copy flow is designable
 * without a configured issuer. The `demo` segment is in the visible string on
 * purpose: this must never be mistaken for, or pasted in place of, a real key.
 */
export function demoIssuedKey(): { key: string; prefix: string } {
  const rand = Math.random().toString(36).slice(2, 10);
  const prefix = `lurq_live_demo_${rand.slice(0, 4)}`;
  return { key: `${prefix}${rand.slice(4)}${Math.random().toString(36).slice(2, 18)}`, prefix };
}

export function demoOutcomes(): DashboardOutcome[] {
  // buildSignal uses the real vocabulary the `report_outcome` tool accepts:
  // installed | compiled | tests_passed | failed (or null when unreported).
  const rows: [string, boolean, string | null, string | null, number][] = [
    ["zod", true, "tests_passed", "runtime schema validation for API inputs", 2],
    ["drizzle-orm", true, "tests_passed", "typed SQL layer for Postgres", 5],
    ["@tanstack/react-query", true, "compiled", "server state + caching in a React SPA", 8],
    ["hono", true, "installed", "small HTTP router for an edge worker", 26],
    ["moment", false, null, "date formatting in a new TS project", 27],
    ["vitest", true, "tests_passed", "unit test runner for an ESM library", 31],
    ["nanoid", true, "installed", "short unique ids without a uuid dep", 49],
    ["date-fns", true, "compiled", "date formatting in a new TS project", 52],
    ["superagent", false, "failed", "http client for a node service", 55],
    ["valibot", false, null, "runtime schema validation for API inputs", 73],
    ["pino", true, "tests_passed", "structured logging for a node service", 96],
    ["lodash", false, null, "deep clone and groupBy helpers", 120],
  ];
  return rows.map(([packageName, accepted, buildSignal, need, h]) => ({
    packageName,
    accepted,
    buildSignal,
    need,
    createdAt: hoursAgo(h),
  }));
}

export function demoContributions(): { total: number; packages: DashboardContribution[] } {
  const rows: [string, string, number, number][] = [
    ["ts-pattern", "utility", 71, 1],
    ["unplugin-fonts", "build-tool", 58, 4],
    ["hono-rate-limiter", "utility", 52, 7],
    ["drizzle-zod", "validation", 66, 11],
    ["@formkit/tempo", "date-time", 61, 16],
    ["oxlint", "linting", 74, 22],
    ["arktype", "validation", 69, 25],
  ];
  const packages = rows.map(([name, category, healthScore, daysAgo]) => ({
    name,
    category,
    healthScore,
    firstRequestedAt: `${dayISO(daysAgo)}T14:12:00.000Z`,
  }));
  return { total: packages.length, packages };
}
