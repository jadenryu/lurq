/**
 * Server-only loaders for the dashboard pages. One place that knows how to:
 *
 *  1. resolve the signed-in `ownerId` (always the individual Clerk `userId`),
 *  2. substitute demo fixtures for the accounts in `LURQ_DEMO_EMAILS`,
 *  3. degrade without taking the page down when the MCP server is unreachable.
 *
 * On (3): the UI deliberately presents a failed read the same way it presents an
 * empty account — as a new user who hasn't generated data yet, not as an error.
 * A first-time visitor should never be met with "connection failed"; in the
 * overwhelmingly common case (a fresh signup against a not-yet-configured
 * endpoint) "here's how to get started" is both friendlier and more accurate
 * about what they need to do next.
 *
 * The trade-off is that a genuine outage looks like an empty account to the user,
 * so the `failed` flag is logged server-side. That keeps it diagnosable in logs
 * without putting an alarm in front of someone who has nothing to be alarmed
 * about. Callers still receive the flag if they ever need to distinguish.
 */
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import {
  demoContributions,
  demoKeys,
  demoOutcomes,
  demoUsage,
  isDemoUser,
} from "@/lib/demo-data";
import {
  fetchContributions,
  fetchKeys,
  fetchOutcomes,
  fetchUsage,
  type DashboardContribution,
  type DashboardKey,
  type DashboardOutcome,
  type DashboardUsage,
} from "@/lib/lurq-issuer";

export interface Loaded<T> {
  data: T;
  /** True when fixtures were served instead of live data. */
  demo: boolean;
  /** True when the live read threw (backend down / misconfigured). */
  failed: boolean;
}

const EMPTY_USAGE: DashboardUsage = { today: 0, series: [], byTool: [] };

/**
 * Resolve `{ userId, demo }` once per request; `null` userId means signed out.
 *
 * Wrapped in React's `cache` because the demo check hits Clerk's Backend API, and
 * the overview page fans out to four loaders in parallel — without memoization
 * that's four identical round trips to Clerk for one page render.
 */
const context = cache(async (): Promise<{ userId: string | null; demo: boolean }> => {
  const { userId } = await auth();
  if (!userId) return { userId: null, demo: false };
  return { userId, demo: await isDemoUser(userId) };
});

/** Run a live read, or hand back the fixture, without ever throwing. */
async function load<T>(
  live: (userId: string) => Promise<T>,
  fixture: () => T,
  empty: T,
): Promise<Loaded<T>> {
  const { userId, demo } = await context();
  if (!userId) return { data: empty, demo: false, failed: false };
  if (demo) return { data: fixture(), demo: true, failed: false };
  try {
    return { data: await live(userId), demo: false, failed: false };
  } catch (err) {
    // The user sees a new-user state, so this line is the only trace an outage
    // leaves. Keep it loud enough to find in logs.
    console.warn(
      "[lurq] dashboard read failed; rendering the new-user state instead.",
      err instanceof Error ? err.message : String(err),
    );
    return { data: empty, demo: false, failed: true };
  }
}

export function loadKeys(): Promise<Loaded<DashboardKey[]>> {
  return load(fetchKeys, demoKeys, []);
}

export function loadUsage(days = 30): Promise<Loaded<DashboardUsage>> {
  return load((userId) => fetchUsage(userId, days), () => demoUsage(days), EMPTY_USAGE);
}

export function loadOutcomes(): Promise<Loaded<DashboardOutcome[]>> {
  return load((userId) => fetchOutcomes(userId), demoOutcomes, []);
}

export function loadContributions(): Promise<
  Loaded<{ total: number; packages: DashboardContribution[] }>
> {
  return load((userId) => fetchContributions(userId), demoContributions, {
    total: 0,
    packages: [],
  });
}

export interface OverviewData {
  keys: DashboardKey[];
  usage: DashboardUsage;
  outcomes: DashboardOutcome[];
  contributions: { total: number; packages: DashboardContribution[] };
}

/**
 * Everything the overview needs, in parallel. Each read degrades on its own, so
 * one slow endpoint can't blank the whole page.
 */
export async function loadOverview(days = 30): Promise<Loaded<OverviewData>> {
  const [keys, usage, outcomes, contributions] = await Promise.all([
    loadKeys(),
    loadUsage(days),
    loadOutcomes(),
    loadContributions(),
  ]);
  return {
    data: {
      keys: keys.data,
      usage: usage.data,
      outcomes: outcomes.data,
      contributions: contributions.data,
    },
    demo: keys.demo,
    failed: keys.failed && usage.failed && outcomes.failed && contributions.failed,
  };
}
