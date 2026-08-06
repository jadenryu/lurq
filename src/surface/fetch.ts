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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    await (await import('node:fs/promises')).writeFile(tgz, buf);
    // `tar` only unpacks; it never executes anything from the archive.
    await execFileP('tar', ['xzf', tgz, '-C', dir], { timeout: FETCH_TIMEOUT_MS });
    const pkgDir = join(dir, 'package');
    // Sanity: npm tarballs always root at `package/`.
    await readFile(join(pkgDir, 'package.json'), 'utf8');
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
