/**
 * Server-only client for the hosted MCP server's dashboard-authenticated routes
 * (`/keys`, `/outcomes` on src/mcp/http.ts). The web app never talks to Postgres
 * directly: every dashboard read/write goes through here, authenticated with
 * the shared LURQ_ISSUER_SECRET. Never import this from a "use client" file.
 */

// Relative: root tests reach this file through other web modules, where `@/`
// does not resolve.
import type { BuilderProfile, BuilderStanding, SavedBuilderScan } from "./builder-profile";

export interface DashboardKey {
  id: number;
  prefix: string;
  label: string | null;
  tier: string;
  /** Absent from a backend older than scoped keys. */
  scopes?: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface DashboardOutcome {
  packageName: string;
  accepted: boolean;
  buildSignal: string | null;
  need: string | null;
  createdAt: string;
}

export class LurqIssuerError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function baseUrl(): string {
  const base = process.env.LURQ_MCP_URL;
  if (!base) throw new LurqIssuerError("Key issuance isn't configured yet.", 503);
  return base.replace(/\/$/, "");
}

function issuerSecret(): string {
  const secret = process.env.LURQ_ISSUER_SECRET;
  if (!secret) throw new LurqIssuerError("Key issuance isn't configured yet.", 503);
  return secret;
}

async function issuerFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${baseUrl()}${path}`;
  const secret = issuerSecret();
  try {
    return await fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${secret}` },
    });
  } catch {
    throw new LurqIssuerError("Key service unreachable.", 502);
  }
}

export async function fetchKeys(ownerId: string): Promise<DashboardKey[]> {
  const res = await issuerFetch(`/keys?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw new LurqIssuerError("Could not list keys.", 502);
  const data = (await res.json()) as { keys: DashboardKey[] };
  return data.keys;
}

export async function issueKey(args: {
  ownerId: string;
  label?: string;
  scopes?: string[];
}): Promise<{ key: string; prefix: string }> {
  const res = await issuerFetch("/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  // 403 is a plan gate with a message worth showing; anything else is ours.
  if (res.status === 403) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new LurqIssuerError(data.error ?? "Your plan cannot issue that key.", 403);
  }
  if (!res.ok) throw new LurqIssuerError("Could not issue a key. Try again.", 502);
  const data = (await res.json()) as { key?: string; prefix?: string };
  if (!data.key) throw new LurqIssuerError("Issuer returned no key.", 502);
  return { key: data.key, prefix: data.prefix ?? "" };
}

export async function revokeKeyByPrefix(ownerId: string, prefix: string): Promise<boolean> {
  const res = await issuerFetch(`/keys/${encodeURIComponent(prefix)}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new LurqIssuerError("Could not revoke key.", 502);
  return true;
}

export async function rotateKeyByPrefix(
  ownerId: string,
  prefix: string,
): Promise<{ key: string; prefix: string } | null> {
  const res = await issuerFetch(`/keys/${encodeURIComponent(prefix)}/rotate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new LurqIssuerError("Could not rotate key.", 502);
  return (await res.json()) as { key: string; prefix: string };
}

export async function fetchOutcomes(ownerId: string, limit?: number): Promise<DashboardOutcome[]> {
  const qs = new URLSearchParams({ ownerId });
  if (limit) qs.set("limit", String(limit));
  const res = await issuerFetch(`/outcomes?${qs.toString()}`);
  if (!res.ok) throw new LurqIssuerError("Could not fetch outcomes.", 502);
  const data = (await res.json()) as { outcomes: DashboardOutcome[] };
  return data.outcomes;
}

export interface DashboardUsage {
  today: number;
  series: { date: string; count: number }[];
  byTool: { tool: string; count: number }[];
}

export interface DashboardContribution {
  name: string;
  category: string | null;
  healthScore: number | null;
  firstRequestedAt: string;
}

export async function fetchUsage(ownerId: string, days = 30): Promise<DashboardUsage> {
  const qs = new URLSearchParams({ ownerId, days: String(days) });
  const res = await issuerFetch(`/usage?${qs.toString()}`);
  if (!res.ok) throw new LurqIssuerError("Could not fetch usage.", 502);
  const data = (await res.json()) as Partial<DashboardUsage>;
  return { today: data.today ?? 0, series: data.series ?? [], byTool: data.byTool ?? [] };
}

// ── Repo autopilot ──────────────────────────────────────────────────────────

/**
 * The resolved tree beyond the manifest. `null` on a repo means GitHub's
 * dependency graph is off there: "we could not look", which the UI renders
 * differently from "nothing found".
 */
export interface TransitiveSummary {
  resolved: number;
  tracked: number;
  /** Transitives whose PACKAGE has known advisories, not proven against the
   *  installed version, since lurq stores no affected-version ranges. */
  advisoryPackages: number;
  deprecated: number;
  truncated: boolean;
  /** True when the SBOM carried usable dependency edges, so `pulledInBy` means
   *  something. False means blame paths were unavailable for this repo. */
  attributed: boolean;
}

export interface TransitiveRisk {
  name: string;
  version: string;
  latest: string | null;
  advisories: number;
  deprecated: boolean;
  /** Direct dependencies that pull this in, the real upgrade targets. Empty
   *  means unattributed, never "nothing depends on it". */
  pulledInBy: string[];
}

export interface RepoDriftSummary {
  depsDeclared: number;
  depsTracked: number;
  majorDrift: number;
  anyDrift: number;
  deprecated: number;
  advisories: number;
  /** Peer/engine conflicts at latest versions. `null` = the repo predates the
   *  check and has not been rescanned, which is not the same as zero. */
  conflicts: number | null;
  transitive: TransitiveSummary | null;
}

/** A peer-dependency or engine disagreement across the repo's dependencies. */
export interface StackConflict {
  source: "peer-deps" | "engines" | "sandbox";
  packages: string[];
  detail: string;
  requirement?: { peer: string; range: string; resolved: string | null };
}

export interface RepoPolicy {
  enabled: boolean;
  scope: "security" | "blocking" | "all";
  autoMerge: boolean;
  /**
   * How far the armed workflow goes. Mirrors the server's `RepoPolicy`.
   *
   * Absent derives from `enabled` (armed meant the agent), so a policy stored
   * before this field behaves exactly as it did. `fix` opens a pull request
   * with only the changes lurq can prove and needs no Anthropic credential.
   */
  mode?: "comment" | "fix" | "pr";
  /**
   * Read-only checks the generated workflow should run. Mirrors the server's
   * `RepoPolicy` in src/github/types.ts — this type is declared separately, so
   * the two drift unless changed together.
   *
   * Absent means NOT GRANTED, never a permissive default: a policy stored
   * before checks existed has no such key.
   */
  checks?: {
    /** `lurq check-env`: variables the code reads that nothing declares. */
    env?: boolean;
  };
}

export interface DashboardRepo {
  id: number;
  fullName: string;
  defaultBranch: string | null;
  isPrivate: boolean;
  policy: RepoPolicy;
  drift: RepoDriftSummary | null;
  lastScanAt: string | null;
  lastScanError: string | null;
  /**
   * What this repo's own workflow has done, as opposed to what its policy
   * permits. `lastScanAt` above is lurq reading the manifests from our side;
   * this is the workflow running on theirs, and a repo can be armed with the
   * workflow never committed.
   *
   * `null` means it has never reported a run. That is NOT proof the workflow is
   * missing — a repo with nothing behind reports nothing — so rendering it as a
   * failure needs drift too.
   */
  upkeep: {
    /** ISO string: dates arrive over the wire, like `lastScanAt`. */
    lastRunAt: string;
    runs: number;
    /** Runs that reached a pull request. */
    delivered: number;
    failed: number;
    /**
     * Runs that only analysed (`checked`). When this equals `runs`, the
     * committed workflow never got past comment mode — which is different from
     * a repo that had nothing worth a pull request, and is the only sound way
     * to tell those apart.
     */
    analysedOnly: number;
  } | null;
}

export interface DashboardDep {
  name: string;
  range: string;
  /**
   * Every manifest that declares this package, with that manifest's own range.
   *
   * The scan has always computed and sent this; the dashboard type used to drop
   * it on the floor. It is the answer to the question a monorepo actually has
   * when it sees drift — *which* of my twelve package.json files pins this, and
   * to what — so the row expands onto it rather than sending anyone to grep.
   *
   * Optional because a scan recorded before this shipped has no such field.
   */
  declaredIn?: { path: string; range: string }[];
  resolved: string | null;
  latest: string | null;
  majorsBehind: number;
  deprecated: boolean;
  advisories: number;
}

/**
 * A 404 from any repo route means the backend has no GitHub App configured, not
 * that the request was wrong. Callers render the "connect GitHub" state for it
 * rather than an error: it is the pre-setup case, not a failure.
 */
export class GithubNotConfiguredError extends LurqIssuerError {
  constructor() {
    super("GitHub integration isn't configured yet.", 404);
  }
}

function assertRepoOk(res: Response, message: string): void {
  if (res.status === 404) throw new GithubNotConfiguredError();
  if (!res.ok) throw new LurqIssuerError(message, 502);
}

export async function fetchRepos(ownerId: string): Promise<DashboardRepo[]> {
  const res = await issuerFetch(`/repos?ownerId=${encodeURIComponent(ownerId)}`);
  assertRepoOk(res, "Could not list repos.");
  const data = (await res.json()) as { repos?: DashboardRepo[] };
  return data.repos ?? [];
}

/**
 * A breaking release that landed on a dependency of a connected repo, recorded
 * by the sync the moment the new major appeared rather than at the next scan.
 */
export interface RepoAlert {
  id: number;
  /** Null when the repo is not connected: lurq heard about it from a
   *  `check-upgrade` run, so there is no repo page to link to. */
  repoId: number | null;
  repoFullName: string;
  packageName: string;
  /** The range the repo declared when the release landed. */
  range: string;
  /** What that range resolved to at the last scan. Null when unknown. */
  fromVersion: string | null;
  toVersion: string;
  /** True when the declared range already admits the new major, the next clean
   *  install takes it without anyone editing a manifest. */
  inRange: boolean;
  createdAt: string;
}

export async function fetchAlerts(ownerId: string): Promise<RepoAlert[]> {
  const res = await issuerFetch(`/repos/alerts?ownerId=${encodeURIComponent(ownerId)}`);
  assertRepoOk(res, "Could not list alerts.");
  const data = (await res.json()) as { alerts?: RepoAlert[] };
  return data.alerts ?? [];
}

export interface UpgradeRun {
  id: number;
  packageName: string;
  fromVersion: string;
  toVersion: string;
  severity: "blocking" | "warning" | "ok" | "unverified";
  status: "checked" | "skipped" | "edited" | "pr_open" | "merged" | "failed";
  symbolsAffected: string[];
  callSites: number;
  callSiteFiles: string[] | null;
  filesChanged: number | null;
  testsPassed: boolean | null;
  prUrl: string | null;
  runUrl: string;
  createdAt: string;
}

/** Autopilot totals. `unverified` is reported alongside, never inside, the rest. */
export interface UpgradeImpact {
  analysed: number;
  blocking: number;
  callSites: number;
  prsOpened: number;
  merged: number;
  unverified: number;
}

export const EMPTY_IMPACT: UpgradeImpact = {
  analysed: 0,
  blocking: 0,
  callSites: 0,
  prsOpened: 0,
  merged: 0,
  unverified: 0,
};

export async function fetchImpact(ownerId: string, days = 30): Promise<UpgradeImpact> {
  const qs = new URLSearchParams({ ownerId, days: String(days) });
  const res = await issuerFetch(`/impact?${qs.toString()}`);
  if (!res.ok) throw new LurqIssuerError("Could not read impact.", 502);
  return { ...EMPTY_IMPACT, ...((await res.json()) as Partial<UpgradeImpact>) };
}

export interface RepoDetailPayload extends DashboardRepo {
  deps: DashboardDep[];
  transitiveRisks: TransitiveRisk[];
  /** null when the repo has not been scanned since the check shipped. */
  conflicts: StackConflict[] | null;
  runs: UpgradeRun[];
  /** The workflow file, rendered for this repo's package manager and mode. */
  workflow: string;
  workflowPath: string;
  /** GitHub "new file" URL, prefilled. lurq never commits this itself. */
  setupUrl: string;
}

export async function fetchRepo(ownerId: string, id: number): Promise<RepoDetailPayload | null> {
  const res = await issuerFetch(`/repos/${id}?ownerId=${encodeURIComponent(ownerId)}`);
  if (res.status === 404) {
    // Ambiguous status: the App may be unconfigured, or this repo may not exist
    // for this owner. Both render as "nothing to show here", so don't guess.
    return null;
  }
  if (!res.ok) throw new LurqIssuerError("Could not read repo.", 502);
  const data = (await res.json()) as { repo?: RepoDetailPayload };
  return data.repo ?? null;
}

export type UpgradeVerdict = "removes-exports" | "arity-changed" | "clean" | "unknown";

export interface UpgradeHop {
  fromVersion: string;
  toVersion: string;
  verdict: UpgradeVerdict;
  removed: string[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
}

export interface UpgradeBrief {
  package: string;
  fromVersion: string;
  toVersion: string;
  declaredIn: { path: string; range: string }[];
  hops: UpgradeHop[];
  sequenceNote?: string;
  majorsBehind: number;
  advisories: number;
  deprecated: boolean;
  verdict: UpgradeVerdict;
  removed: string[];
  /** Removed exports the package still ships under another name. Absent from an older API. */
  renamed?: { path: string; to: string[] }[];
  arityChanged: { path: string; from: number | null; to: number | null }[];
  typeOnlyRemoved: string[];
  newlyDeprecated: string[];
  inconclusive?: string;
}

export interface RepoBrief {
  upgrades: UpgradeBrief[];
  omitted: number;
  pending: number;
}

export async function fetchRepoBrief(ownerId: string, id: number): Promise<RepoBrief> {
  const res = await issuerFetch(`/repos/${id}/brief?ownerId=${encodeURIComponent(ownerId)}`);
  assertRepoOk(res, "Could not build the migration brief.");
  const data = (await res.json()) as Partial<RepoBrief>;
  return { upgrades: data.upgrades ?? [], omitted: data.omitted ?? 0, pending: data.pending ?? 0 };
}

export async function connectInstallation(
  ownerId: string,
  installationId: number,
): Promise<number> {
  const res = await issuerFetch("/repos/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, installationId }),
  });
  assertRepoOk(res, "Could not connect the GitHub installation.");
  const data = (await res.json()) as { connected?: number };
  return data.connected ?? 0;
}

export async function scanRepo(ownerId: string, id: number): Promise<void> {
  const res = await issuerFetch(`/repos/${id}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  assertRepoOk(res, "Could not scan the repo.");
}

export async function updateRepoPolicy(
  ownerId: string,
  id: number,
  policy: RepoPolicy,
): Promise<void> {
  const res = await issuerFetch(`/repos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, policy }),
  });
  assertRepoOk(res, "Could not update the policy.");
}

export async function disconnectRepo(ownerId: string, id: number): Promise<void> {
  const res = await issuerFetch(`/repos/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  assertRepoOk(res, "Could not disconnect the repo.");
}

export async function fetchContributions(
  ownerId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ total: number; packages: DashboardContribution[] }> {
  const qs = new URLSearchParams({ ownerId });
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.offset) qs.set("offset", String(opts.offset));
  const res = await issuerFetch(`/contributions?${qs.toString()}`);
  if (!res.ok) throw new LurqIssuerError("Could not fetch contributions.", 502);
  const data = (await res.json()) as { total?: number; packages?: DashboardContribution[] };
  return { total: data.total ?? 0, packages: data.packages ?? [] };
}

/** Rules governing what an agent may *add*, as opposed to what it may upgrade. */
export type AdvisorySeverity = "info" | "low" | "moderate" | "high" | "critical";

export interface SelectionPolicy {
  /** `warn` reports what the rules would refuse without refusing it. */
  mode: "enforce" | "warn";
  /** `expires` is the first day (YYYY-MM-DD) the exception no longer applies. */
  allow: { name: string; reason?: string; expires?: string }[];
  deny: { name: string; reason?: string }[];
  minConfidence: "unproven" | "promising" | "emerging" | "proven" | null;
  licenses: string[] | null;
  blockDeprecated: boolean;
  /** Source repository archived upstream. */
  blockArchived: boolean;
  /** Worst advisory severity tolerated; anything above it is refused. */
  maxAdvisorySeverity: AdvisorySeverity | null;
  minWeeklyDownloads: number | null;
  maxStaleMonths: number | null;
  /** Minified + gzipped, KB. */
  maxBundleKb: number | null;
  /** Cool-down: days since the package was first published. */
  minPackageAgeDays: number | null;
}

export const EMPTY_SELECTION_POLICY: SelectionPolicy = {
  mode: "enforce",
  allow: [],
  deny: [],
  minConfidence: null,
  licenses: null,
  blockDeprecated: false,
  blockArchived: false,
  maxAdvisorySeverity: null,
  minWeeklyDownloads: null,
  maxStaleMonths: null,
  maxBundleKb: null,
  minPackageAgeDays: null,
};

export async function fetchSelectionPolicy(ownerId: string): Promise<SelectionPolicy> {
  const res = await issuerFetch(`/selection-policy?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw new LurqIssuerError("Could not read policy.", 502);
  const data = (await res.json()) as { policy: SelectionPolicy };
  return data.policy;
}

/** A package the policy refused (or warned about), grouped over the window. */
export interface PolicyDecision {
  packageName: string;
  rule: string;
  action: "blocked" | "warned";
  count: number;
  /** UTC day of the latest hit. */
  lastDay: string;
}

/** One saved change to the policy, as -/+ rule sentences. */
export interface PolicyChange {
  /** `dashboard`, or `key lurq_live_…` for a CLI push. */
  actor: string;
  at: string;
  changes: string[];
}

export async function fetchPolicyDecisions(ownerId: string, days = 30): Promise<PolicyDecision[]> {
  const qs = new URLSearchParams({ ownerId, days: String(days) });
  const res = await issuerFetch(`/selection-policy/decisions?${qs.toString()}`);
  if (!res.ok) throw new LurqIssuerError("Could not read policy decisions.", 502);
  return ((await res.json()) as { decisions: PolicyDecision[] }).decisions;
}

export async function fetchPolicyHistory(ownerId: string): Promise<PolicyChange[]> {
  const res = await issuerFetch(`/selection-policy/history?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw new LurqIssuerError("Could not read policy history.", 502);
  return ((await res.json()) as { changes: PolicyChange[] }).changes;
}

/** One connected repo, ruled against the policy. Mirrors src/policy/conformance. */
export interface RepoConformance {
  repoId: number;
  fullName: string;
  checked: number;
  unchecked: number;
  unscored: number;
  total: number;
  violations: { name: string; rule: string; reason: string }[];
}

export interface ConformanceReport {
  /** False = no rule was in force, so nothing was evaluated. An empty repo list
   *  under `false` means "no policy set", never "everything passed". */
  enforcing: boolean;
  repos: RepoConformance[];
}

export const EMPTY_CONFORMANCE: ConformanceReport = { enforcing: false, repos: [] };

export async function fetchConformance(ownerId: string): Promise<ConformanceReport> {
  const res = await issuerFetch(
    `/selection-policy/conformance?ownerId=${encodeURIComponent(ownerId)}`,
  );
  if (!res.ok) throw new LurqIssuerError("Could not read conformance.", 502);
  return (await res.json()) as ConformanceReport;
}

export async function updateSelectionPolicy(
  ownerId: string,
  policy: SelectionPolicy,
): Promise<void> {
  const res = await issuerFetch("/selection-policy", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, policy }),
  });
  if (!res.ok) throw new LurqIssuerError("Could not save policy.", 502);
}

// ── Billing ──────────────────────────────────────────────────────────────────
// Stripe credentials live on the MCP service, never here. These three calls are
// the whole of the web app's involvement in payments: it asks the backend for a
// URL and redirects to it, so nothing that faces the browser holds a key.

export interface BillingSummary {
  tier: "free" | "pro" | "team" | "enterprise";
  planName: string;
  /** Seats billed. 1 for flat plans. */
  seats: number;
  /** Null before a Stripe subscription exists, and for hand-granted plans. */
  interval: "month" | "year" | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  used: number;
  /** null = uncapped. */
  limit: number | null;
  /** False when the deployment has no Stripe configured. */
  billingEnabled: boolean;
  /** True once the account has a Stripe customer, i.e. the portal will open. */
  manageable: boolean;
}

export async function fetchBilling(ownerId: string): Promise<BillingSummary> {
  const res = await issuerFetch(`/billing/subscription?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw new LurqIssuerError("Could not read your plan.", 502);
  return (await res.json()) as BillingSummary;
}

/** A Stripe Checkout URL, or null when this deployment cannot sell that plan. */
export async function startCheckout(args: {
  ownerId: string;
  tier: string;
  interval?: "month" | "year";
  email?: string | null;
  /** Where Stripe's back link returns: the billing page or the landing pricing section. */
  from?: "dashboard" | "pricing";
}): Promise<string | null> {
  const res = await issuerFetch("/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  // 404 = billing not configured, 503 = that plan has no Price yet. Neither is
  // an error the buyer can do anything about, so the caller shows the contact
  // route instead of an alarming failure.
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) throw new LurqIssuerError("Could not start checkout.", 502);
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
}

/** A Stripe Billing Portal URL, or null if the account never had a subscription. */
export async function openBillingPortal(ownerId: string): Promise<string | null> {
  const res = await issuerFetch("/billing/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new LurqIssuerError("Could not open the billing portal.", 502);
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
}

/**
 * The durable Ask budget. One signed write reserves a question's worst case and
 * a second settles the difference; each returns the day's running total and the
 * ceiling, so no separate read is needed.
 *
 * It throws rather than returning a default, and that is the point — a caller
 * enforcing a spend cap has to be able to tell "under the cap" apart from
 * "could not reach the cap", and a helper that swallows the failure and hands
 * back zero turns an outage into unlimited spend.
 */
export interface AskBudget {
  spentMicros: number;
  limitMicros: number;
}

/** What one answered question looked like, for product analytics. Never its text. */
export interface AskAnswered {
  model: string;
  turns: number;
  usd: number;
  cacheReadTokens: number;
}

export async function recordAskSpend(
  ownerId: string,
  usdMicros: number,
  answered?: AskAnswered,
): Promise<AskBudget> {
  const res = await issuerFetch("/ask-budget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, usdMicros, answered }),
  });
  if (!res.ok) throw new LurqIssuerError("Could not record Ask spend.", res.status);
  return (await res.json()) as AskBudget;
}

/** A package tool as the backend's MCP server declares it: JSON Schema input. */
export interface AskTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export async function fetchAskTools(): Promise<AskTool[]> {
  const res = await issuerFetch("/ask-tools");
  if (!res.ok) throw new LurqIssuerError("Could not list Ask tools.", res.status);
  return ((await res.json()) as { tools: AskTool[] }).tools;
}

/** Run one package tool as the signed-in owner. `text` is the tool's JSON result. */
export async function callAskTool(
  ownerId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const res = await issuerFetch("/ask-tools/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, name, arguments: args }),
  });
  // Out of allowance is an answer the model should relay, not a crash.
  if (res.status === 402) {
    return {
      isError: true,
      text: "This account has used this month's lurq calls. It resets when the month turns; upgrading lifts it.",
    };
  }
  if (!res.ok) throw new LurqIssuerError("Could not run that lookup.", res.status);
  return (await res.json()) as { isError: boolean; text: string };
}

// ── Live MCP scans ──────────────────────────────────────────────────────────

export type ScanSeverity = "critical" | "high" | "moderate" | "low" | "info";

export type McpScanStatus =
  | "ok"
  | "partial"
  | "needs_config"
  | "auth_required"
  | "spawn_failed"
  | "timeout"
  | "unreachable"
  | "protocol_error";

export interface McpFinding {
  kind: string;
  severity: ScanSeverity;
  tool: string | null;
  where: string;
  detail: string;
  evidence: string | null;
}

export interface McpServerStats {
  tools: number;
  writes: number;
  destroys: number;
  openWorld: number;
  annotated: number;
  capabilities: Record<string, number>;
}

/** One server as one account runs it, with its latest contract summarised. */
export interface DashboardMcpServer {
  id: number;
  serverKey: string;
  alias: string;
  registry: string;
  packageName: string | null;
  transport: string;
  serverName: string | null;
  serverVersion: string | null;
  lastStatus: McpScanStatus;
  lastError: string | null;
  worstSeverity: ScanSeverity | null;
  firstSeenAt: string;
  lastScannedAt: string;
  lastChangedAt: string | null;
  toolCount: number | null;
  writes: number | null;
  destroys: number | null;
  capabilities: Record<string, number>;
  findings: number;
  openEvents: number;
  openWorst: ScanSeverity | null;
}

export interface McpChangeEvent {
  id: number;
  deploymentId: number;
  severity: ScanSeverity;
  summary: string;
  createdAt: string;
  acknowledgedAt: string | null;
  /** Present on the account-wide feed. */
  alias?: string;
  serverKey?: string;
  diff: {
    rugPull: string[];
    descriptionChanges: { tool: string; field: string; before: string | null; after: string | null }[];
    newFindings: McpFinding[];
    instructionsChanged: boolean;
    promptsAdded: string[];
    promptsRemoved: string[];
    capabilitiesGained: { tool: string; capabilities: string[] }[];
    contract: {
      removedTools: string[];
      addedTools: string[];
      silentDrift: string[];
      annotationFlips: { tool: string; hint: string; from: boolean; to: boolean; widensPrivilege: boolean }[];
      breaking: boolean;
    };
  };
}

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
}

export interface McpObservation {
  id: number;
  status: McpScanStatus;
  contentHash: string | null;
  serverVersion: string | null;
  error: string | null;
  source: string;
  scanCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface McpServerDetail {
  deployment: DashboardMcpServer;
  contract: {
    contentHash: string;
    toolCount: number;
    tools: McpToolInfo[];
    prompts: { name: string; description?: string }[];
    instructions: string | null;
    analysis: {
      capabilities: Record<string, { capability: string; evidence: string }[]>;
      findings: McpFinding[];
      stats: McpServerStats;
    };
  } | null;
  observations: McpObservation[];
  events: McpChangeEvent[];
}

export interface McpServersPayload {
  servers: DashboardMcpServer[];
  events: McpChangeEvent[];
}

export async function fetchMcpServers(ownerId: string): Promise<McpServersPayload> {
  const res = await issuerFetch(`/mcp-servers?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw new LurqIssuerError("Could not read MCP servers.", 502);
  return (await res.json()) as McpServersPayload;
}

export async function fetchMcpServer(ownerId: string, id: number): Promise<McpServerDetail | null> {
  const res = await issuerFetch(`/mcp-servers/${id}?ownerId=${encodeURIComponent(ownerId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new LurqIssuerError("Could not read the MCP server.", 502);
  return (await res.json()) as McpServerDetail;
}

export async function acknowledgeMcpChange(ownerId: string, eventId: number): Promise<boolean> {
  const res = await issuerFetch(`/mcp-servers/events/${eventId}/acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new LurqIssuerError("Could not acknowledge the change.", 502);
  return true;
}

// ── Public MCP endpoints (registry-listed, probed without credentials) ──────

export type PublicEndpointStatus =
  | "open"
  | "auth_required"
  | "not_found"
  | "server_error"
  | "unreachable"
  | "dns_failed"
  | "blocked"
  | "protocol_error"
  | "timeout"
  | "templated";

export type CompatVerdict = "works" | "needs_setup" | "blocked" | "unknown";

export interface PublicEndpointChange {
  id: number;
  kind: "contract" | "auth" | "status";
  severity: ScanSeverity;
  summary: string;
  createdAt: string;
  acknowledged: boolean;
}

export interface PublicEndpointPin {
  endpointId: number;
  url: string;
  note: string | null;
  pinnedAt: string;
  status: PublicEndpointStatus | null;
  lastProbedAt: string | null;
  contractChanged: boolean;
  authChanged: boolean;
  openChanges: number;
  worstOpen: ScanSeverity | null;
}

export interface PublicEndpointDetail {
  endpoint: {
    id: number;
    url: string;
    host: string;
    transport: string;
    status: PublicEndpointStatus | null;
    httpStatus: number | null;
    auth: {
      mode: "none" | "oauth" | "static" | "unknown";
      oauth: { issuer: string | null; cimd: boolean; dcr: boolean; pkceS256: boolean; authorizationServers: string[] } | null;
      declaredHeaders: { name: string; required: boolean; secret: boolean }[];
    } | null;
    violations: { code: string; detail: string }[];
    protocolMode: "stateless" | "initialize" | null;
    protocolVersion: string | null;
    serverName: string | null;
    serverVersion: string | null;
    latencyMs: number | null;
    lastError: string | null;
    firstSeenAt: string;
    lastProbedAt: string | null;
    lastChangedAt: string | null;
    removedAt: string | null;
  };
  servers: string[];
  contract: { tools: McpToolInfo[]; analysis: { stats: McpServerStats; findings: McpFinding[] } } | null;
  observations: { id: number; status: PublicEndpointStatus; httpStatus: number | null; error: string | null; probeCount: number; firstSeenAt: string; lastSeenAt: string }[];
  changes: PublicEndpointChange[];
  pin: PublicEndpointPin | null;
  clients: { client: string; clientName: string; verdict: CompatVerdict; reason: string | null }[];
  summary: Record<CompatVerdict, number>;
}

export async function fetchPinnedEndpoints(ownerId: string): Promise<PublicEndpointPin[]> {
  const res = await issuerFetch(`/mcp-public/pins?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw new LurqIssuerError("Could not read pinned servers.", 502);
  return ((await res.json()) as { pins: PublicEndpointPin[] }).pins ?? [];
}

export async function fetchPublicEndpoint(ownerId: string, endpointId: number): Promise<PublicEndpointDetail | null> {
  const res = await issuerFetch(`/mcp-public/${endpointId}?ownerId=${encodeURIComponent(ownerId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new LurqIssuerError("Could not read the MCP server.", 502);
  return (await res.json()) as PublicEndpointDetail;
}

async function publicPost(path: string, ownerId: string, what: string): Promise<Response | null> {
  const res = await issuerFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new LurqIssuerError(`Could not ${what}.`, 502);
  return res;
}

export async function acknowledgePublicMcpChange(ownerId: string, changeId: number): Promise<boolean> {
  return (await publicPost(`/mcp-public/changes/${changeId}/acknowledge`, ownerId, "acknowledge the change")) !== null;
}

export async function pinPublicEndpoint(ownerId: string, endpointId: number): Promise<boolean> {
  return (await publicPost(`/mcp-public/${endpointId}/pin`, ownerId, "pin the server")) !== null;
}

export async function unpinPublicEndpoint(ownerId: string, endpointId: number): Promise<boolean> {
  const res = await publicPost(`/mcp-public/${endpointId}/unpin`, ownerId, "unpin the server");
  return res ? Boolean(((await res.json()) as { unpinned?: boolean }).unpinned) : false;
}

// ── Account email ────────────────────────────────────────────────────────────

export interface NotificationPreferences {
  urgentEmail: boolean;
  weeklyDigest: boolean;
  /** False when the deployment has no email provider: toggles govern nothing yet. */
  emailConfigured: boolean;
}

export async function fetchNotificationPreferences(ownerId: string): Promise<NotificationPreferences> {
  const res = await issuerFetch(`/notification-preferences?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw new LurqIssuerError("Could not read email settings.", 502);
  return (await res.json()) as NotificationPreferences;
}

export async function updateNotificationPreferences(
  ownerId: string,
  patch: Partial<Pick<NotificationPreferences, "urgentEmail" | "weeklyDigest">>,
): Promise<NotificationPreferences> {
  const res = await issuerFetch("/notification-preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, ...patch }),
  });
  if (!res.ok) throw new LurqIssuerError("Could not save email settings.", 502);
  return (await res.json()) as NotificationPreferences;
}

/** Unsubscribe by the token in an email link. Resolves the same whether or not it matched. */
export async function unsubscribeWithToken(token: string, kind: "urgent" | "digest"): Promise<boolean> {
  const res = await issuerFetch("/notifications/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, kind }),
  });
  return res.ok;
}

// ── Alert channels ───────────────────────────────────────────────────────────

export type ChannelKind = "slack" | "discord" | "teams" | "webhook";
export type ChannelSeverity = "critical" | "high" | "moderate" | "low";

export interface AlertChannel {
  id: number;
  kind: ChannelKind;
  label: string | null;
  urlHint: string;
  minSeverity: ChannelSeverity;
  enabled: boolean;
  disabledReason: string | null;
  lastDeliveredAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface ChannelsPayload {
  channels: AlertChannel[];
  /** The plan includes channels. */
  allowed: boolean;
  /** The deployment can store channel URLs. */
  configured: boolean;
}

/** An error the API meant for the person at the form, passed through as-is. */
async function apiError(res: Response, fallback: string): Promise<LurqIssuerError> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new LurqIssuerError(body?.error ?? fallback, res.status);
}

export async function fetchChannels(ownerId: string): Promise<ChannelsPayload> {
  const res = await issuerFetch(`/notification-channels?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw await apiError(res, "Could not read alert channels.");
  return (await res.json()) as ChannelsPayload;
}

export async function createChannel(
  ownerId: string,
  input: { kind: ChannelKind; url: string; label?: string; minSeverity: ChannelSeverity },
): Promise<{ channel: AlertChannel; signingSecret?: string }> {
  const res = await issuerFetch("/notification-channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, ...input }),
  });
  if (!res.ok) throw await apiError(res, "Could not add the channel.");
  return (await res.json()) as { channel: AlertChannel; signingSecret?: string };
}

export async function updateChannel(
  ownerId: string,
  id: number,
  patch: Partial<Pick<AlertChannel, "enabled" | "minSeverity" | "label">>,
): Promise<AlertChannel> {
  const res = await issuerFetch(`/notification-channels/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, ...patch }),
  });
  if (!res.ok) throw await apiError(res, "Could not update the channel.");
  return ((await res.json()) as { channel: AlertChannel }).channel;
}

export async function testChannel(ownerId: string, id: number): Promise<{ ok: boolean; error: string | null }> {
  const res = await issuerFetch(`/notification-channels/${id}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  if (!res.ok) throw await apiError(res, "Could not test the channel.");
  return (await res.json()) as { ok: boolean; error: string | null };
}

export async function removeChannel(ownerId: string, id: number): Promise<void> {
  const res = await issuerFetch(`/notification-channels/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  if (!res.ok) throw await apiError(res, "Could not remove the channel.");
}

// ── Builder reports ─────────────────────────────────────────────────────────

export interface SavedBuilderReport {
  profile: BuilderProfile;
  scannedAt: string;
  standing: BuilderStanding | null;
}

export async function fetchBuilderScans(ownerId: string): Promise<SavedBuilderScan[]> {
  const res = await issuerFetch(`/builder-scans?${new URLSearchParams({ ownerId }).toString()}`);
  if (!res.ok) throw new LurqIssuerError("Could not load saved scans.", 502);
  return ((await res.json()) as { scans?: SavedBuilderScan[] }).scans ?? [];
}

/** Null when nothing is saved for that target, including on an API that predates saved scans (404 either way). */
export async function fetchBuilderScan(
  ownerId: string,
  target: string,
): Promise<SavedBuilderReport | null> {
  const res = await issuerFetch(`/builder-scans/one?${new URLSearchParams({ ownerId, target }).toString()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new LurqIssuerError("Could not load that saved scan.", 502);
  const { scan } = (await res.json()) as { scan: SavedBuilderReport };
  // An API from before standings sends none: "no comparison", not an error.
  return { ...scan, standing: scan.standing ?? null };
}

/** Saves (or overwrites) the account's copy for this target; resolves to when it was taken, and the standing. */
export async function saveBuilderScan(
  ownerId: string,
  target: string,
  profile: BuilderProfile,
): Promise<{ scannedAt: string; standing: BuilderStanding | null }> {
  const res = await issuerFetch("/builder-scans", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId, target, profile }),
  });
  if (!res.ok) throw new LurqIssuerError("Could not save that scan.", 502);
  const data = (await res.json()) as { scannedAt: string; standing?: BuilderStanding | null };
  return { scannedAt: data.scannedAt, standing: data.standing ?? null };
}
