/**
 * Server-only client for the hosted MCP server's dashboard-authenticated routes
 * (`/keys`, `/outcomes` on src/mcp/http.ts). The web app never talks to Postgres
 * directly: every dashboard read/write goes through here, authenticated with
 * the shared LURQ_ISSUER_SECRET. Never import this from a "use client" file.
 */

export interface DashboardKey {
  id: number;
  prefix: string;
  label: string | null;
  tier: string;
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
}): Promise<{ key: string; prefix: string }> {
  const res = await issuerFetch("/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
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
}

export interface DashboardDep {
  name: string;
  range: string;
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
  repoId: number;
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
export interface SelectionPolicy {
  allow: string[];
  deny: { name: string; reason?: string }[];
  minConfidence: "unproven" | "promising" | "emerging" | "proven" | null;
  licenses: string[] | null;
  blockDeprecated: boolean;
}

export const EMPTY_SELECTION_POLICY: SelectionPolicy = {
  allow: [],
  deny: [],
  minConfidence: null,
  licenses: null,
  blockDeprecated: false,
};

export async function fetchSelectionPolicy(ownerId: string): Promise<SelectionPolicy> {
  const res = await issuerFetch(`/selection-policy?ownerId=${encodeURIComponent(ownerId)}`);
  if (!res.ok) throw new LurqIssuerError("Could not read policy.", 502);
  const data = (await res.json()) as { policy: SelectionPolicy };
  return data.policy;
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
  tier: "free" | "pro" | "enterprise";
  planName: string;
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
  email?: string | null;
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
