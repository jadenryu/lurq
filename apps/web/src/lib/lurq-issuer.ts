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
