/**
 * Server-only client for the hosted MCP server's dashboard-authenticated routes
 * (`/keys`, `/outcomes` on src/mcp/http.ts). The web app never talks to Postgres
 * directly — every dashboard read/write goes through here, authenticated with
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
 * dependency graph is off there — "we could not look", which the UI renders
 * differently from "nothing found".
 */
export interface TransitiveSummary {
  resolved: number;
  tracked: number;
  /** Transitives whose PACKAGE has known advisories — not proven against the
   *  installed version, since lurq stores no affected-version ranges. */
  advisoryPackages: number;
  deprecated: number;
  truncated: boolean;
}

export interface TransitiveRisk {
  name: string;
  version: string;
  latest: string | null;
  advisories: number;
  deprecated: boolean;
}

export interface RepoDriftSummary {
  depsDeclared: number;
  depsTracked: number;
  majorDrift: number;
  anyDrift: number;
  deprecated: number;
  advisories: number;
  transitive: TransitiveSummary | null;
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
 * rather than an error — it is the pre-setup case, not a failure.
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
  runs: UpgradeRun[];
  /** The workflow file, rendered for this repo's package manager and mode. */
  workflow: string;
  workflowPath: string;
  /** GitHub "new file" URL, prefilled. lurq never commits this itself. */
  setupUrl: string;
}

export async function fetchRepo(
  ownerId: string,
  id: number,
): Promise<RepoDetailPayload | null> {
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
