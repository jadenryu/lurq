/**
 * Public MCP server pages: lurq.run/mcp/<registry name>.
 *
 * Written for the search that brings people here — "does <server> work with
 * ChatGPT", "<server> MCP 401", "<server> Cursor setup" — and for the agent that
 * web-searched the same thing. The API serves a summary; the live, per-version
 * answer with ready-to-paste config is `connect_check`, behind a key.
 *
 * Registry names contain a slash (`io.github.acme/weather`), so the page is a
 * catch-all route and every segment is encoded on its own.
 */
import type { CompatVerdict, PublicEndpointStatus } from "./lurq-issuer";

export const MCP_SERVER_REVALIDATE = 86_400;

export interface PublicMcpEndpoint {
  url: string;
  transport: string;
  status: PublicEndpointStatus | null;
  authMode: "none" | "oauth" | "static" | "unknown";
  oauth: { cimd: boolean; dcr: boolean; pkceS256: boolean } | null;
  violations: { code: string; detail: string }[];
  toolNames: string[] | null;
  lastProbedAt: string | null;
}

export interface PublicMcpServerSummary {
  name: string;
  title: string | null;
  description: string | null;
  websiteUrl: string | null;
  repositoryUrl: string | null;
  version: string;
  endpoint: PublicMcpEndpoint | null;
  otherEndpoints: number;
  hasPackage: boolean;
  clients: { client: string; clientName: string; verdict: CompatVerdict; reason: string | null }[];
  summary: Record<CompatVerdict, number>;
  dataAsOf: string | null;
}

export function mcpServerPath(name: string): string {
  return `/mcp/${name.split("/").map(encodeURIComponent).join("/")}`;
}

/** The registry name a catch-all route's segments spell. */
export function mcpNameFromSegments(segments: string[]): string {
  return segments.map((s) => decodeURIComponent(s)).join("/");
}

function base(): string {
  const url = process.env.LURQ_MCP_URL;
  if (!url) throw new Error("LURQ_MCP_URL is not set; MCP server pages cannot load.");
  return url.replace(/\/$/, "");
}

/**
 * Null only for a real 404. A 5xx throws instead, so an outage is never cached
 * as "no such server" for the whole revalidate window.
 */
export async function fetchPublicMcpServer(name: string): Promise<PublicMcpServerSummary | null> {
  const res = await fetch(`${base()}/public/mcp-server?name=${encodeURIComponent(name)}`, {
    next: { revalidate: MCP_SERVER_REVALIDATE },
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`public MCP server read failed with HTTP ${res.status}`);
  return (await res.json()) as PublicMcpServerSummary;
}

/** Every server with a public page, for the sitemap. Empty on failure: a crawler retries. */
export async function fetchPublicMcpServerList(): Promise<{ name: string; dataAsOf: string | null }[]> {
  try {
    const res = await fetch(`${base()}/public/mcp-servers`, { cache: "no-store" });
    if (!res.ok) return [];
    return ((await res.json()) as { servers: { name: string; dataAsOf: string | null }[] }).servers ?? [];
  } catch {
    return [];
  }
}
