/**
 * Server-only loaders for the dashboard pages. One place that knows how to:
 *
 *  1. resolve the signed-in `ownerId` (always the individual Clerk `userId`),
 *  2. substitute demo fixtures for the accounts in `LURQ_DEMO_EMAILS`,
 *  3. degrade without taking the page down when the MCP server is unreachable.
 *
 * On (3): the UI deliberately presents a failed read the same way it presents an
 * empty account: as a new user who hasn't generated data yet, not as an error.
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
  demoAlerts,
  demoContributions,
  demoKeys,
  demoImpact,
  demoOutcomes,
  demoRepoBrief,
  demoRepoDetail,
  demoRepos,
  demoUsage,
  isDemoUser,
} from "@/lib/demo-data";
import {
  fetchAlerts,
  fetchContributions,
  fetchKeys,
  fetchOutcomes,
  fetchRepo,
  fetchRepoBrief,
  fetchRepos,
  fetchUsage,
  GithubNotConfiguredError,
  type DashboardContribution,
  type DashboardKey,
  type DashboardOutcome,
  type DashboardRepo,
  type DashboardUsage,
  type RepoAlert,
  type RepoBrief,
  type RepoDetailPayload,
  type UpgradeImpact,
  EMPTY_IMPACT,
  fetchImpact,
  fetchSelectionPolicy,
  EMPTY_SELECTION_POLICY,
  type SelectionPolicy,
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
 * the overview page fans out to four loaders in parallel, without memoization
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

/**
 * Connected repos.
 *
 * `configured` is separate from `failed` on purpose. Everywhere else the
 * dashboard collapses "no data" and "backend unreachable" into the new-user
 * state, but here the two lead to different actions: an unconfigured GitHub App
 * means *nothing the user does* will connect a repo, and telling them to click
 * "Connect GitHub" would send them into a dead end.
 */
export interface ReposData {
  repos: DashboardRepo[];
  configured: boolean;
}

/**
 * The owner's selection policy.
 *
 * Falls back to the empty policy on failure rather than erroring the page. An
 * unreachable policy service must not read as "you have no rules" though, so the
 * `failed` flag is what the UI keys its warning off, the same discipline the
 * rest of this file follows about never presenting an absence as an answer.
 */
export async function loadSelectionPolicy(): Promise<Loaded<SelectionPolicy>> {
  const { userId, demo } = await context();
  if (!userId) return { data: EMPTY_SELECTION_POLICY, demo: false, failed: false };
  if (demo) return { data: EMPTY_SELECTION_POLICY, demo: true, failed: false };
  try {
    return { data: await fetchSelectionPolicy(userId), demo: false, failed: false };
  } catch (err) {
    console.warn(
      "[lurq] selection policy read failed.",
      err instanceof Error ? err.message : String(err),
    );
    return { data: EMPTY_SELECTION_POLICY, demo: false, failed: true };
  }
}

export async function loadRepos(): Promise<Loaded<ReposData>> {
  const { userId, demo } = await context();
  if (!userId) return { data: { repos: [], configured: false }, demo: false, failed: false };
  if (demo) return { data: { repos: demoRepos(), configured: true }, demo: true, failed: false };
  try {
    return {
      data: { repos: await fetchRepos(userId), configured: true },
      demo: false,
      failed: false,
    };
  } catch (err) {
    if (err instanceof GithubNotConfiguredError) {
      return { data: { repos: [], configured: false }, demo: false, failed: false };
    }
    console.warn(
      "[lurq] repo read failed; rendering the empty state instead.",
      err instanceof Error ? err.message : String(err),
    );
    return { data: { repos: [], configured: true }, demo: false, failed: true };
  }
}

/**
 * Breaking releases that landed on connected repos' dependencies.
 *
 * Degrades to an empty feed, including when GitHub is unconfigured: an alert
 * list is a "nothing has broken lately" surface, and an error banner there would
 * read as an incident.
 */
export function loadAlerts(): Promise<Loaded<RepoAlert[]>> {
  return load((userId) => fetchAlerts(userId), demoAlerts, []);
}

const EMPTY_BRIEF: RepoBrief = { upgrades: [], omitted: 0, pending: 0 };

/**
 * The migration brief. Loaded separately from the repo itself so the page can
 * stream: drift numbers render immediately while the brief, which fans out to
 * one surface diff per upgrade: resolves behind a boundary.
 */
export async function loadRepoBrief(id: number): Promise<Loaded<RepoBrief>> {
  const { userId, demo } = await context();
  if (!userId) return { data: EMPTY_BRIEF, demo: false, failed: false };
  if (demo) return { data: demoRepoBrief(), demo: true, failed: false };
  try {
    return { data: await fetchRepoBrief(userId, id), demo: false, failed: false };
  } catch (err) {
    console.warn(
      "[lurq] migration brief read failed.",
      err instanceof Error ? err.message : String(err),
    );
    return { data: EMPTY_BRIEF, demo: false, failed: true };
  }
}

export type RepoDetail = RepoDetailPayload;

export async function loadRepo(id: number): Promise<Loaded<RepoDetail | null>> {
  const { userId, demo } = await context();
  if (!userId) return { data: null, demo: false, failed: false };
  if (demo) {
    const repo = demoRepos().find((r) => r.id === id);
    return {
      data: repo ? { ...repo, ...demoRepoDetail(repo.fullName) } : null,
      demo: true,
      failed: false,
    };
  }
  try {
    return { data: await fetchRepo(userId, id), demo: false, failed: false };
  } catch (err) {
    console.warn(
      "[lurq] repo detail read failed.",
      err instanceof Error ? err.message : String(err),
    );
    return { data: null, demo: false, failed: true };
  }
}

/** Autopilot impact. Zeroes on failure, this sits beside real numbers, so an
 *  error must not render as an alarming figure. */
export async function loadImpact(days = 30): Promise<Loaded<UpgradeImpact>> {
  return load((userId) => fetchImpact(userId, days), demoImpact, EMPTY_IMPACT);
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
