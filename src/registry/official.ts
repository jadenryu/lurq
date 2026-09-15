/**
 * The official MCP registry, read in bulk.
 *
 * `surface/mcpRegistry.ts` asks the registry one question — what does this npm
 * package declare? — and memoizes the answer. The contract pipeline needs the
 * whole thing: every published server, every remote endpoint with the headers
 * it declares, every package with the environment it wants, and the lifecycle
 * metadata that says when an entry was deleted or superseded.
 *
 * Two properties drive the shape of this module:
 *
 *   1. Entries are written by strangers. One malformed `server.json` must not
 *      fail the page it arrives on, so each entry is validated on its own and a
 *      bad one is counted, never thrown. Every string is length-capped for the
 *      same reason every ceiling in `mcpScan/snapshot.ts` exists.
 *   2. The crawl is incremental. `updated_since` returns every version touched
 *      after a watermark, deleted ones included, so a caller that remembers the
 *      largest `updatedAt` it stored never re-reads the registry from scratch.
 *
 * Transport is `core/http`: per-host limiting and Retry-After-aware backoff,
 * with the response cache off, because a crawl that reads a stale page skips
 * servers silently.
 */
import { z } from 'zod';
import { httpGetJson } from '../core/http';

export const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0.1';
const REGISTRY_HOST = 'registry.modelcontextprotocol.io';
const META_KEY = 'io.modelcontextprotocol.registry/official';
/** The API's own ceiling. */
export const MAX_PAGE_SIZE = 100;

const str = (max: number) => z.string().max(max);

const HeaderSchema = z.object({
  name: str(256).min(1),
  description: str(2_000).optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  format: str(64).optional(),
  /** A fixed value the publisher expects. Never a secret by construction; still capped. */
  value: str(2_000).optional(),
});

const RemoteSchema = z.object({
  type: str(64),
  url: str(2_048).min(1),
  headers: z.array(HeaderSchema).max(50).optional(),
});

const EnvVarSchema = z.object({
  name: str(256).min(1),
  description: str(2_000).optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  format: str(64).optional(),
});

const ArgSchema = z.object({ name: str(256).optional(), value: str(2_000).optional() });

const PackageSchema = z.object({
  registryType: str(32).optional(),
  identifier: str(512).optional(),
  version: str(128).optional(),
  runtimeHint: str(64).optional(),
  transport: z.object({ type: str(64).optional(), url: str(2_048).optional() }).optional(),
  environmentVariables: z.array(EnvVarSchema).max(200).optional(),
  runtimeArguments: z.array(ArgSchema).max(100).optional(),
  packageArguments: z.array(ArgSchema).max(100).optional(),
});

const ServerSchema = z.object({
  name: str(512).min(1),
  version: str(128).min(1),
  title: str(512).optional(),
  description: str(4_000).optional(),
  websiteUrl: str(2_048).optional(),
  repository: z.object({ url: str(2_048).optional(), source: str(64).optional() }).optional(),
  remotes: z.array(RemoteSchema).max(50).optional(),
  packages: z.array(PackageSchema).max(50).optional(),
});

const MetaSchema = z.object({
  status: str(32).optional(),
  publishedAt: str(64).optional(),
  updatedAt: str(64).optional(),
  statusChangedAt: str(64).optional(),
  isLatest: z.boolean().optional(),
});

export type RegistryHeader = z.infer<typeof HeaderSchema>;
export type RegistryRemote = z.infer<typeof RemoteSchema>;
export type RegistryPackageEntry = z.infer<typeof PackageSchema>;

export interface RegistryEntry {
  name: string;
  version: string;
  title: string | null;
  description: string | null;
  websiteUrl: string | null;
  repositoryUrl: string | null;
  remotes: RegistryRemote[];
  packages: RegistryPackageEntry[];
  /** `active`, `deprecated`, `deleted`, … as the registry reports it. */
  status: string;
  isLatest: boolean;
  publishedAt: Date | null;
  updatedAt: Date | null;
}

export interface RegistryPage {
  entries: RegistryEntry[];
  /** Entries on this page that failed validation and were skipped. */
  rejected: number;
  nextCursor: string | null;
}

function date(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** One raw list item → a validated entry, or null when it is not usable. */
export function parseRegistryItem(raw: unknown): RegistryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as { server?: unknown; _meta?: Record<string, unknown> };
  const server = ServerSchema.safeParse(item.server);
  if (!server.success) return null;
  const meta = MetaSchema.safeParse(item._meta?.[META_KEY] ?? {});
  const m = meta.success ? meta.data : {};
  const s = server.data;
  return {
    name: s.name,
    version: s.version,
    title: s.title ?? null,
    description: s.description ?? null,
    websiteUrl: s.websiteUrl ?? null,
    repositoryUrl: s.repository?.url ?? null,
    remotes: s.remotes ?? [],
    packages: s.packages ?? [],
    status: m.status ?? 'active',
    isLatest: m.isLatest === true,
    publishedAt: date(m.publishedAt),
    updatedAt: date(m.updatedAt),
  };
}

export interface ListOptions {
  /** Only versions updated after this instant (deleted ones included). */
  updatedSince?: Date | null;
  /** `latest` for one version per server; omit for every version. */
  version?: 'latest';
  pageSize?: number;
  /** Safety stop for a runaway cursor. */
  maxPages?: number;
  /** Resume from a cursor a previous run stopped at. */
  cursor?: string | null;
  base?: string;
  fetchImpl?: typeof fetch;
  retries?: number;
}

/** Read the registry page by page. Throws on transport failure, never on a bad entry. */
export async function* listRegistry(opts: ListOptions = {}): AsyncGenerator<RegistryPage> {
  const base = opts.base ?? REGISTRY_BASE;
  const pageSize = Math.min(Math.max(opts.pageSize ?? MAX_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const maxPages = opts.maxPages ?? 10_000;
  let cursor = opts.cursor ?? null;

  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ limit: String(pageSize) });
    if (opts.version) q.set('version', opts.version);
    if (opts.updatedSince) q.set('updated_since', opts.updatedSince.toISOString());
    if (cursor) q.set('cursor', cursor);

    const { data } = await httpGetJson<{ servers?: unknown[]; metadata?: { nextCursor?: string } }>(
      `${base}/servers?${q.toString()}`,
      { host: REGISTRY_HOST, ttlMs: 0, timeoutMs: 30_000, retries: opts.retries ?? 3, fetchImpl: opts.fetchImpl },
    );

    const raw = Array.isArray(data?.servers) ? data.servers : [];
    const entries: RegistryEntry[] = [];
    let rejected = 0;
    for (const item of raw) {
      const e = parseRegistryItem(item);
      if (e) entries.push(e);
      else rejected++;
    }
    const next = typeof data?.metadata?.nextCursor === 'string' && data.metadata.nextCursor ? data.metadata.nextCursor : null;
    yield { entries, rejected, nextCursor: next };
    // A cursor that does not advance would loop forever on the same page.
    if (!next || next === cursor) return;
    cursor = next;
  }
}
