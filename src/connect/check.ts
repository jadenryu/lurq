/**
 * `connect_check` — will this MCP server work in my client, and what does it take?
 *
 * The question a developer (or their agent) has at the moment of wiring a
 * server in, answered from evidence on both sides:
 *
 *   - the server: lurq's credential-free probe of its endpoint (status, how it
 *     authenticates, spec deviations, the tool contract when readable) and the
 *     registry's declaration (headers, packages, environment)
 *   - the client: sourced constraint profiles (`clients/profiles.ts`)
 *
 * Accepts what people actually have in hand: an endpoint URL, a registry name
 * (`io.github.acme/weather`) or an npm package name.
 *
 * A URL lurq has never seen can be probed live, within a short budget. That
 * result is answered and NOT stored: `mcp_remote_endpoints` is a public table of
 * registry-listed endpoints, and an unlisted endpoint someone pastes — often a
 * company's internal server — must not become a row anyone can read.
 */
import type { SafeFetch } from '../core/safeFetch';
import type { Database } from '../db/client';
import { getContract } from '../db/mcpScans';
import {
  findRegistryServers,
  getDeclaredHeaders,
  getEndpointByUrl,
  getEndpointsForServer,
  listEndpointChanges,
} from '../db/remoteEndpoints';
import type { McpRemoteEndpointRow } from '../db/schema';
import type { McpTool } from '../surface/mcp';
import { fetchServerManifest, type RequiredConfig } from '../surface/mcpRegistry';
import { evaluateClient, type ClientCompat, type CompatVerdict, type PackageFacts, type RemoteFacts, type ServerFacts } from '../clients/evaluate';
import { CLIENT_PROFILES } from '../clients/profiles';
import { renderClientConfig, type RenderedConfig } from '../clients/render';
import type { ClientId } from '../clients/types';
import type { AuthProfile, EndpointStatus, Violation } from '../remoteProbe/types';
import { endpointIdentity } from '../remoteProbe/url';

export interface ConnectCheckInput {
  /** An endpoint URL, a registry server name, or an npm package name. */
  server: string;
  /** One client, or omit for every client lurq has a profile for. */
  client?: ClientId | null;
}

export interface ConnectCheckDeps {
  /** Probe a URL lurq has no record of. Off unless the caller opts in. */
  liveProbe?: { fetch: SafeFetch; budgetMs?: number } | null;
}

export interface ClientAnswer extends ClientCompat {
  /** Ready-to-paste config for this client; empty when blocked or not renderable. */
  config: RenderedConfig[];
}

export interface ConnectCheckResponse {
  query: string;
  resolvedAs: 'endpoint' | 'registry' | 'npm' | 'url' | null;
  server: { name: string; registryName: string | null; url: string | null; package: string | null };
  evidence: {
    source: 'probe' | 'live_probe' | 'registry' | 'none';
    status: EndpointStatus | null;
    observedAt: string | null;
    auth: { mode: AuthProfile['mode']; issuer: string | null; cimd: boolean | null; dcr: boolean | null; pkceS256: boolean | null } | null;
    violations: Violation[];
    toolCount: number | null;
    recentChanges: { kind: string; severity: string; summary: string; at: string }[];
  };
  clients: ClientAnswer[];
  summary: Record<CompatVerdict, number>;
  coverageNote: string;
}

const CLIENT_FACTS_READ = '2026-09-15';
const LIVE_BUDGET_MS = 8_000;

export function aliasFor(name: string): string {
  let source = name;
  if (/^https?:\/\//i.test(name)) {
    // An endpoint's path is usually just `/mcp`; the host names the service.
    try {
      const labels = new URL(name).hostname.toLowerCase().split('.').slice(0, -1).filter((l) => !['mcp', 'api', 'www', 'server'].includes(l));
      source = labels[0] ?? source;
    } catch {
      /* keep the raw text */
    }
  }
  const last = source.replace(/\/+$/, '').split('/').pop() ?? source;
  const base = last.replace(/^@[^/]+\//, '').replace(/[-_.]?mcp[-_.]?(server)?$/i, '') || last;
  return (base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server').slice(0, 30);
}

function remoteFactsFromRow(row: McpRemoteEndpointRow, declared: RemoteFacts['declaredHeaders']): RemoteFacts {
  return {
    url: row.url,
    transport: row.transport,
    templated: row.templated,
    status: row.lastStatus,
    observedAt: row.lastProbedAt,
    auth: row.auth ? { ...row.auth, declaredHeaders: declared } : null,
    violations: row.violations ?? [],
    declaredHeaders: declared,
  };
}

async function toolsFor(db: Database, contentHash: string | null): Promise<McpTool[] | null> {
  if (!contentHash) return null;
  const contract = await getContract(db, contentHash);
  return contract?.tools ?? null;
}

/** Among a server's endpoints, the one a client should use: answering first, then by recency. */
function pickEndpoint(rows: McpRemoteEndpointRow[]): McpRemoteEndpointRow | null {
  const rank = (s: EndpointStatus | null) => (s === 'open' ? 0 : s === 'auth_required' ? 1 : s === null ? 2 : 3);
  return [...rows].sort((a, b) => rank(a.lastStatus) - rank(b.lastStatus) || (b.lastProbedAt?.getTime() ?? 0) - (a.lastProbedAt?.getTime() ?? 0))[0] ?? null;
}

function packageFacts(packages: { registryType?: string; identifier?: string; environmentVariables?: { name: string; description?: string; isRequired?: boolean; isSecret?: boolean; format?: string }[] }[]): PackageFacts | null {
  const pkg = packages.find((p) => p.registryType === 'npm' && p.identifier) ?? packages.find((p) => p.identifier);
  if (!pkg?.identifier) return null;
  const env: RequiredConfig[] = (pkg.environmentVariables ?? []).map((e) => ({
    name: e.name,
    description: e.description ?? null,
    required: e.isRequired === true,
    secret: e.isSecret === true,
    format: e.format ?? null,
  }));
  return { registryType: pkg.registryType ?? 'unknown', identifier: pkg.identifier, env };
}

/** Headers a rendered config must carry for this server. */
function headersToRender(remote: RemoteFacts | null): string[] {
  if (!remote) return [];
  const declared = remote.declaredHeaders.filter((h) => h.required || h.secret).map((h) => h.name);
  if (declared.length) return declared;
  return remote.auth?.mode === 'static' ? ['Authorization'] : [];
}

export async function handleConnectCheck(db: Database, input: ConnectCheckInput, deps: ConnectCheckDeps = {}): Promise<ConnectCheckResponse> {
  const query = input.server.trim();
  let resolvedAs: ConnectCheckResponse['resolvedAs'] = null;
  let source: ConnectCheckResponse['evidence']['source'] = 'none';
  let facts: ServerFacts = { name: query, alias: aliasFor(query), remote: null, package: null, tools: null };
  let registryName: string | null = null;
  let endpointId: number | null = null;

  if (/^https?:\/\//i.test(query)) {
    resolvedAs = 'url';
    const row = await getEndpointByUrl(db, query);
    if (row && !row.removedAt) {
      resolvedAs = 'endpoint';
      endpointId = row.id;
      const declared = (await getDeclaredHeaders(db, [row.id])).get(row.id) ?? [];
      facts = { ...facts, remote: remoteFactsFromRow(row, declared), tools: await toolsFor(db, row.lastContentHash) };
      if (row.lastStatus) source = 'probe';
    } else if (deps.liveProbe) {
      const { probeEndpoint } = await import('../remoteProbe/probe');
      const r = await probeEndpoint(query, { fetch: deps.liveProbe.fetch, budgetMs: deps.liveProbe.budgetMs ?? LIVE_BUDGET_MS });
      facts = {
        ...facts,
        remote: { url: r.url, transport: r.transport ?? 'streamable-http', templated: r.status === 'templated', status: r.status, observedAt: new Date(), auth: r.auth, violations: r.violations, declaredHeaders: [] },
        tools: r.snapshot?.tools ?? null,
      };
      source = 'live_probe';
    } else {
      const id = endpointIdentity(query);
      facts = { ...facts, remote: id ? { url: id.url, transport: 'streamable-http', templated: id.templated, status: null, observedAt: null, auth: null, violations: [], declaredHeaders: [] } : null };
    }
  } else {
    const [server] = await findRegistryServers(db, query, 1);
    if (server) {
      resolvedAs = 'registry';
      registryName = server.name;
      source = 'registry';
      facts = { ...facts, name: server.name, alias: aliasFor(server.name), package: packageFacts(server.packages) };
      const linked = await getEndpointsForServer(db, server.name);
      const best = pickEndpoint(linked.map((l) => l.endpoint));
      if (best) {
        endpointId = best.id;
        const declared = (await getDeclaredHeaders(db, [best.id])).get(best.id) ?? [];
        facts.remote = remoteFactsFromRow(best, declared);
        facts.tools = await toolsFor(db, best.lastContentHash);
        if (best.lastStatus) source = 'probe';
      }
    } else {
      const manifest = await fetchServerManifest(query);
      if (manifest) {
        resolvedAs = 'npm';
        registryName = manifest.registryName;
        source = 'registry';
        facts = { ...facts, alias: aliasFor(query), package: manifest.remoteOnly ? null : { registryType: 'npm', identifier: manifest.npmPackage, env: manifest.env } };
      }
    }
  }

  const profiles = input.client ? CLIENT_PROFILES.filter((c) => c.id === input.client) : CLIENT_PROFILES;
  const clients: ClientAnswer[] = profiles.map((profile) => {
    const compat = evaluateClient(facts, profile);
    const config =
      compat.via === 'remote' && facts.remote && compat.verdict !== 'blocked'
        ? renderClientConfig(profile, { name: facts.alias, url: facts.remote.url, headers: headersToRender(facts.remote) })
        : [];
    return { ...compat, config };
  });

  const summary: Record<CompatVerdict, number> = { works: 0, needs_setup: 0, blocked: 0, unknown: 0 };
  for (const c of clients) summary[c.verdict]++;

  const changes = endpointId ? await listEndpointChanges(db, endpointId, 5) : [];
  const r = facts.remote;
  const observedAt = r?.observedAt ? r.observedAt.toISOString() : null;
  return {
    query,
    resolvedAs,
    server: { name: facts.name, registryName, url: r?.url ?? null, package: facts.package?.identifier ?? null },
    evidence: {
      source,
      status: r?.status ?? null,
      observedAt,
      auth: r?.auth
        ? { mode: r.auth.mode, issuer: r.auth.oauth?.issuer ?? null, cimd: r.auth.oauth?.cimd ?? null, dcr: r.auth.oauth?.dcr ?? null, pkceS256: r.auth.oauth?.pkceS256 ?? null }
        : null,
      violations: r?.violations ?? [],
      toolCount: facts.tools?.length ?? null,
      recentChanges: changes.map((c) => ({ kind: c.kind, severity: c.severity, summary: c.summary, at: c.createdAt.toISOString() })),
    },
    clients,
    summary,
    coverageNote:
      resolvedAs === null
        ? `lurq has no record of "${query}" in the official MCP registry or its probe index. This is NOT evidence the server does not exist or will not work.`
        : `Server facts: ${source === 'probe' ? `credential-free probe, ${observedAt ?? 'date unknown'}` : source === 'live_probe' ? 'a live credential-free probe just now (not stored)' : 'registry declaration only, not yet probed'}. Client facts: primary sources read ${CLIENT_FACTS_READ}. "unknown" means not established, never "will not work".`,
  };
}
