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
import { extractSurface } from './extract';
import type { ExtractedSurface } from './types';

const execFileP = promisify(execFile);
const FETCH_TIMEOUT_MS = 60_000;
const MAX_TARBALL_BYTES = 64 * 1024 * 1024;

export interface FetchedSurface {
  surface: ExtractedSurface;
  /** sha256 of the tarball — the extraction cache key. */
  artifactHash: string;
  resolvedVersion: string;
}

interface DistInfo {
  tarball: string;
  version: string;
}

/** Resolve a version spec to a concrete tarball URL via the registry. */
export async function resolveTarball(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<DistInfo | null> {
  const spec = version ?? 'latest';
  const url = `https://registry.npmjs.org/${encodeNpmName(name)}/${encodeURIComponent(spec)}`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const body = (await res.json()) as { version?: string; dist?: { tarball?: string } };
  if (!body?.dist?.tarball || !body.version) return null;
  return { tarball: body.dist.tarball, version: body.version };
}

/**
 * Download, hash, unpack, and extract. Throws only on infrastructure failure —
 * the caller records UNVERIFIABLE and requeues rather than condemning the
 * package, because a rate limit is not evidence about a package (§4.2).
 */
export async function fetchAndExtract(
  name: string,
  version: string | null,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<FetchedSurface | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const dist = await resolveTarball(name, version, fetchImpl);
  if (!dist) return null;

  const res = await fetchImpl(dist.tarball);
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status} ${dist.tarball}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_TARBALL_BYTES) {
    throw new Error(`tarball exceeds ${MAX_TARBALL_BYTES} bytes: ${name}@${dist.version}`);
  }
  const artifactHash = createHash('sha256').update(buf).digest('hex');

  const dir = await mkdtemp(join(tmpdir(), 'lurq-surface-'));
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
          version: dist.version,
          tier: 'shipped_js_ast',
          entry: null,
          symbols: [],
          filesWalked: 0,
          externalReExports: [],
          undeclaredReason: 'tarball contains no readable package.json',
        },
        artifactHash,
        resolvedVersion: dist.version,
      };
    }

    const surface = extractSurface(pkgDir);
    return {
      surface: { ...surface, package: name, version: dist.version },
      artifactHash,
      resolvedVersion: dist.version,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
