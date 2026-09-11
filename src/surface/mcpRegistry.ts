/**
 * The official MCP registry, read for what a server DECLARES about itself.
 *
 * A probe can only observe a server it can start, and a large share of useful
 * servers refuse to start without credentials. Treating that as a failed
 * handshake is the §4.1 mistake in its purest form: "we could not check" is not
 * "we checked and it does not work", and a server that wants a `GITHUB_TOKEN`
 * is not broken.
 *
 * `server.json` carries the answer as data. Every published server declares its
 * `environmentVariables` — name, description, required, secret — plus its
 * transport and any launch arguments. So lurq can tell an agent exactly what
 * the server needs BEFORE spending a sandbox on a probe that was always going
 * to fail, and the agent can turn that into a specific request to its user
 * rather than a shrug.
 *
 * Best-effort by design. The registry is a third party on the network, and its
 * being down must never turn into a verdict about a server: every failure here
 * returns null and the caller proceeds exactly as it did before this file
 * existed.
 */
import { logger } from '../core/logger';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0.1';
const TIMEOUT_MS = 8_000;

/** One environment variable a server declares, straight from `server.json`. */
export interface RequiredConfig {
  name: string;
  description: string | null;
  /** The server will not start without it. */
  required: boolean;
  /** A credential. Never log it, never put it in evidence, never cache a value. */
  secret: boolean;
  format: string | null;
}

export interface McpServerManifest {
  /** Reverse-DNS registry name, e.g. `io.github.acme/weather`. */
  registryName: string;
  npmPackage: string;
  version: string | null;
  /** `stdio`, `streamable-http`, … Null when the package declares none. */
  transport: string | null;
  env: RequiredConfig[];
  /** Positional/flag arguments the server needs at launch. */
  args: string[];
  /** The server is published ONLY as a remote endpoint — nothing to install. */
  remoteOnly: boolean;
}

export interface RegistryPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  transport?: { type?: string };
  environmentVariables?: {
    name?: string;
    description?: string;
    isRequired?: boolean;
    isSecret?: boolean;
    format?: string;
  }[];
  runtimeArguments?: { value?: string; name?: string }[];
  packageArguments?: { value?: string; name?: string }[];
}

export interface RegistryServer {
  name?: string;
  version?: string;
  packages?: RegistryPackage[];
  remotes?: { type?: string; url?: string }[];
}

/**
 * In-process memo, including negative results.
 *
 * Most servers are not in the registry, and re-asking on every probe would add
 * a network round-trip to the miss path — the common path. A null is as worth
 * remembering as a hit.
 */
const memo = new Map<string, McpServerManifest | null>();

async function getJson(url: string): Promise<unknown | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    // Network trouble is ours, not the server's. Never escalate it to a verdict.
    logger.debug?.({ url, err: String(err) }, 'mcp registry unreachable');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function toManifest(server: RegistryServer, npmPackage: string): McpServerManifest | null {
  const pkg = (server.packages ?? []).find(
    (p) => p.registryType === 'npm' && p.identifier === npmPackage,
  );
  const remoteOnly = !pkg && (server.remotes ?? []).length > 0;
  if (!pkg && !remoteOnly) return null;

  const args = [...(pkg?.runtimeArguments ?? []), ...(pkg?.packageArguments ?? [])]
    .map((a) => a.value ?? a.name)
    .filter((a): a is string => typeof a === 'string' && a.length > 0);

  return {
    registryName: server.name ?? npmPackage,
    npmPackage,
    version: pkg?.version ?? server.version ?? null,
    transport: pkg?.transport?.type ?? (remoteOnly ? (server.remotes?.[0]?.type ?? null) : null),
    env: (pkg?.environmentVariables ?? [])
      .map((e) => ({
        name: e.name ?? '',
        description: e.description ?? null,
        required: e.isRequired === true,
        secret: e.isSecret === true,
        format: e.format ?? null,
      }))
      .filter((e) => e.name.length > 0),
    args,
    remoteOnly,
  };
}

/**
 * What does this npm-published MCP server declare it needs?
 *
 * Looked up by npm package name rather than registry name, because that is the
 * identifier every caller already has — an entry in someone's MCP config names
 * the package, not the reverse-DNS registry id.
 *
 * Null means "the registry has nothing for this", which is the common case and
 * carries no implication about the server.
 */
export async function fetchServerManifest(npmPackage: string): Promise<McpServerManifest | null> {
  const hit = memo.get(npmPackage);
  if (hit !== undefined) return hit;

  const body = (await getJson(
    `${REGISTRY}/servers?search=${encodeURIComponent(npmPackage)}&limit=20`,
  )) as { servers?: { server?: RegistryServer }[] } | null;

  let found: McpServerManifest | null = null;
  for (const row of body?.servers ?? []) {
    // Search is fuzzy, so the identifier has to be matched exactly — otherwise
    // `server-memory` picks up whatever else mentions memory and lurq starts
    // reporting another project's credential requirements as this one's.
    const m = row.server ? toManifest(row.server, npmPackage) : null;
    if (m) {
      found = m;
      break;
    }
  }
  memo.set(npmPackage, found);
  return found;
}

/** Required, unsatisfied config for this server — what an agent must ask for. */
export function missingConfig(
  manifest: McpServerManifest | null,
  env: NodeJS.ProcessEnv = process.env,
): RequiredConfig[] {
  return (manifest?.env ?? []).filter((e) => e.required && !env[e.name]);
}

/** One line an agent can put in front of a user, naming what it needs and why. */
export function configRequestLine(server: string, missing: RequiredConfig[]): string {
  if (missing.length === 0) return '';
  const items = missing
    .map((m) => `${m.name}${m.description ? ` (${m.description})` : ''}`)
    .join('; ');
  return (
    `${server} declares ${missing.length} required setting(s) before it will start: ${items}. ` +
    `Ask the user to supply ${missing.some((m) => m.secret) ? 'these values (at least one is a credential — take it from the user, never from a log or a guess)' : 'these values'}, ` +
    `then re-run the probe with them set.`
  );
}

/** Test seam: drop memoized lookups. */
export function clearManifestCache(): void {
  memo.clear();
}
