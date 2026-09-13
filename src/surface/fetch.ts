/**
 * Fetch stage (§6.1): pull a package tarball, hash it, extract its tier-A
 * surface, and hand it back for storage.
 *
 * The digest is the cache key. An unchanged tarball must never pay for
 * extraction twice — that is what keeps cost sublinear as breadth grows (§6.5),
 * and breadth is exactly when cost starts to matter.
 *
 * Nothing here executes package code. The tarball is unpacked and parsed; no
 * install runs, no lifecycle script fires. That property is load-bearing for
 * §9.2: "we read the shipped JS in your registry" survives a security review
 * that "we run your packages in our sandbox" does not.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { encodeNpmName } from '../ingestion/sources/npmRegistry';
import type { ExtractedSurface } from './types';

const execFileP = promisify(execFile);
const FETCH_TIMEOUT_MS = 60_000;
const MAX_TARBALL_BYTES = 64 * 1024 * 1024;
const RETRIES = 3;
const RETRY_BASE_MS = 400;
const MAX_RETRY_AFTER_MS = 10_000;

export interface FetchedSurface {
  surface: ExtractedSurface;
  /**
   * Surfaces of the subpath entry points named in `opts.subpaths`, keyed by
   * subpath (`pg-core`). Extracted from the same unpacked tarball as the root,
   * because a package with four used entry points would otherwise cost four
   * downloads of the same archive.
   */
  subpathSurfaces?: Record<string, ExtractedSurface>;
  /** sha256 of the tarball — the extraction cache key. */
  artifactHash: string;
  resolvedVersion: string;
}

interface DistInfo {
  tarball: string;
  version: string;
  /** Subresource-integrity string the registry publishes, e.g. `sha512-…`. */
  integrity?: string;
  /** Legacy sha1 hex digest, for tarballs published before `integrity`. */
  shasum?: string;
}

/**
 * `fetch` with a timeout, retrying what is not the package's fault: a dropped
 * connection, a 429, a 5xx.
 *
 * A registry hiccup must not turn an upgrade into "unverified", and a hung
 * socket must not hang a CI job for the runner's full six hours. Every other
 * status, 404 included, goes back to the caller to interpret.
 */
async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      if (attempt >= RETRIES) throw err;
    }
    if (res && res.status !== 429 && res.status < 500) return res;
    if (res && attempt >= RETRIES) return res;
    const retryAfter = Number(res?.headers.get('retry-after'));
    const wait =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
        : RETRY_BASE_MS * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/**
 * Resolve a version spec to a concrete tarball URL via the registry.
 *
 * Null only when the registry says the version does not exist (404), which is a
 * fact about the package. Any other failure throws: reading a 403 or an
 * exhausted 503 as "not published" would tell the caller something false.
 */
export async function resolveTarball(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<DistInfo | null> {
  const spec = version ?? 'latest';
  const url = `https://registry.npmjs.org/${encodeNpmName(name)}/${encodeURIComponent(spec)}`;
  const res = await fetchWithRetry(fetchImpl, url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`registry answered ${res.status} for ${name}@${spec}`);
  const body = (await res.json()) as {
    version?: string;
    dist?: { tarball?: string; integrity?: string; shasum?: string };
  };
  if (!body?.dist?.tarball || !body.version) return null;
  return {
    tarball: body.dist.tarball,
    version: body.version,
    ...(body.dist.integrity ? { integrity: body.dist.integrity } : {}),
    ...(body.dist.shasum ? { shasum: body.dist.shasum } : {}),
  };
}

/**
 * The bytes must be the ones the registry published.
 *
 * A proxy, a stale cache, or a tampered mirror serving something else is the one
 * input a tool that reads package code has to refuse, and the registry states
 * the digest to compare against. sha512 when published, sha1 for older tarballs.
 */
export function verifyIntegrity(
  buf: Buffer,
  dist: Pick<DistInfo, 'integrity' | 'shasum'>,
  label: string,
): void {
  const sri = dist.integrity?.split(/\s+/).find((s) => s.startsWith('sha512-'));
  if (sri) {
    if (createHash('sha512').update(buf).digest('base64') !== sri.slice('sha512-'.length)) {
      throw new Error(`tarball integrity mismatch for ${label}`);
    }
    return;
  }
  if (dist.shasum && createHash('sha1').update(buf).digest('hex') !== dist.shasum) {
    throw new Error(`tarball shasum mismatch for ${label}`);
  }
}

/** A package tarball unpacked into a temporary directory. `cleanup` removes it. */
export interface Unpacked {
  pkgDir: string;
  version: string;
  /** sha256 of the tarball — the extraction cache key. */
  artifactHash: string;
  cleanup: () => Promise<void>;
}

/**
 * Download, hash, and unpack. Throws only on infrastructure failure — the
 * caller records UNVERIFIABLE and requeues rather than condemning the package,
 * because a rate limit is not evidence about a package (§4.2). Null when the
 * version does not resolve on the registry.
 *
 * Split from extraction so a caller can keep two versions on disk at once:
 * `check-upgrade` type-checks the project against both.
 */
export async function unpackPackage(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Unpacked | null> {
  const dist = await resolveTarball(name, version, fetchImpl);
  if (!dist) return null;

  const res = await fetchWithRetry(fetchImpl, dist.tarball);
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status} ${dist.tarball}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_TARBALL_BYTES) {
    throw new Error(`tarball exceeds ${MAX_TARBALL_BYTES} bytes: ${name}@${dist.version}`);
  }
  verifyIntegrity(buf, dist, `${name}@${dist.version}`);
  const artifactHash = createHash('sha256').update(buf).digest('hex');

  const dir = await mkdtemp(join(tmpdir(), 'lurq-surface-'));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    const tgz = join(dir, 'pkg.tgz');
    const pkgDir = join(dir, 'pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(tgz, buf);
    // `tar` only unpacks; it never executes anything from the archive.
    //
    // --strip-components=1 rather than assuming a `package/` root: npm tarballs
    // USUALLY root there, but not always — @types/* roots at the type name
    // (`node/`, not `package/`), so a hardcoded path fails extraction outright
    // for all of DefinitelyTyped. Stripping the first component normalizes any
    // root name.
    await execFileP('tar', ['xzf', tgz, '--strip-components=1', '-C', pkgDir], {
      timeout: FETCH_TIMEOUT_MS,
    });
    return { pkgDir, version: dist.version, artifactHash, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/** The tier-A surface of an unpacked package, plus any subpath entries asked for. */
export async function extractUnpacked(
  name: string,
  unpacked: Unpacked,
  subpaths?: string[],
): Promise<FetchedSurface> {
  const { pkgDir, version, artifactHash } = unpacked;

  // A tarball with no readable manifest is a fact ABOUT THE PACKAGE, not an
  // infrastructure failure — it must surface as UNDECLARED rather than throw,
  // or the drain will treat a type-only package as our own outage and retry
  // it forever (§4.2).
  try {
    await readFile(join(pkgDir, 'package.json'), 'utf8');
  } catch {
    return {
      surface: {
        package: name,
        version,
        tier: 'shipped_js_ast',
        entry: null,
        symbols: [],
        filesWalked: 0,
        externalReExports: [],
        undeclaredReason: 'tarball contains no readable package.json',
      },
      artifactHash,
      resolvedVersion: version,
    };
  }

  // Loaded here, not at module scope: `extractSurface` pulls in the TypeScript
  // compiler, which is an operator-only dependency. A static edge put it in
  // every bundle chunk that reaches this file, so `sync` (which never
  // extracts) refused to boot without it.
  const { extractSurface } = await import('./extract');
  const surface = extractSurface(pkgDir);
  const subpathSurfaces: Record<string, ExtractedSurface> = {};
  for (const sub of new Set(subpaths ?? [])) {
    subpathSurfaces[sub] = {
      ...extractSurface(pkgDir, { subpath: sub }),
      package: `${name}/${sub}`,
      version,
    };
  }
  return {
    surface: { ...surface, package: name, version },
    ...(subpaths?.length ? { subpathSurfaces } : {}),
    artifactHash,
    resolvedVersion: version,
  };
}

/** Download, unpack, extract, and clean up. See `unpackPackage` for what throws. */
export async function fetchAndExtract(
  name: string,
  version: string | null,
  opts: { fetchImpl?: typeof fetch; subpaths?: string[] } = {},
): Promise<FetchedSurface | null> {
  const unpacked = await unpackPackage(name, version, opts.fetchImpl ?? fetch);
  if (!unpacked) return null;
  try {
    return await extractUnpacked(name, unpacked, opts.subpaths);
  } finally {
    await unpacked.cleanup();
  }
}
