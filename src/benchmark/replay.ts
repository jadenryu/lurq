/**
 * Repository replay — M0's human-baseline arm (v1 spec §11.1, §12).
 *
 * Takes a real checkout, reads the versions it ACTUALLY has pinned, scans what
 * its source ACTUALLY references, and checks each referenced symbol against the
 * surface of that pinned version. No model, no synthetic task: this measures
 * human-authored production code against real dependencies.
 *
 * Why this matters more than the generated suite: M0's kill condition is
 * "agent miss rate is not materially above human baseline", and a generated-code
 * run has no baseline to compare against. Same harness, two populations —
 * human-authored files and agent-authored ones — is the only way to answer it.
 *
 * Versions come from `node_modules/<pkg>/package.json` when the checkout is
 * installed. That is the exact code the project runs, it costs no network, and
 * it avoids re-deriving a resolution the package manager already did.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { extractSurface } from '../surface/extract';
import { fetchAndExtract } from '../surface/fetch';
import { SURFACE_CLAIM_KINDS, isRootSpecifier, scanReferences } from '../surface/references';
import { runtimeSymbols } from '../surface/types';

export interface PackageReplay {
  package: string;
  version: string;
  /** Where the surface came from — local install, or fetched from the registry. */
  source: 'node_modules' | 'registry';
  referenced: string[];
  missing: string[];
}

export interface RepoReplay {
  repo: string;
  packages: PackageReplay[];
  /** Dependencies referenced but not scoreable, with the reason. */
  skipped: { package: string; reason: string }[];
  filesScanned: number;
  totalReferenced: number;
  totalMissing: number;
  missRate: number | null;
  /** Distinct packages the source actually imports — the real exposure. */
  packagesReferenced: number;
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Locate an installed package the way Node resolves it: check `node_modules`
 * here, then in each parent directory.
 *
 * Walking up is not a nicety — npm/pnpm workspaces HOIST dependencies to the
 * repo root, so a package used by `apps/web` lives in `<root>/node_modules`.
 * Looking only in the given directory finds nothing and silently drops every
 * dependency, which zeroes out coverage for essentially every monorepo.
 */
function resolveInstalled(fromDir: string, pkg: string): string | null {
  let dir = resolvePath(fromDir);
  for (let depth = 0; depth < 12; depth++) {
    const candidate = join(dir, 'node_modules', pkg);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The version actually installed, read from the package's own manifest. */
function installedVersion(repo: string, pkg: string): string | null {
  const dir = resolveInstalled(repo, pkg);
  if (!dir) return null;
  try {
    return (
      (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string })
        .version ?? null
    );
  } catch {
    return null;
  }
}

export async function replayRepo(
  repo: string,
  opts: { includeDev?: boolean; fetchMissing?: boolean } = {},
): Promise<RepoReplay> {
  const manifestPath = join(repo, 'package.json');
  if (!existsSync(manifestPath)) throw new Error(`no package.json in ${repo}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...(opts.includeDev ? Object.keys(manifest.devDependencies ?? {}) : []),
  ]);

  const refs = scanReferences(repo);
  const packages: PackageReplay[] = [];
  const skipped: RepoReplay['skipped'] = [];

  for (const pkgRefs of refs) {
    const name = pkgRefs.package;
    // Only score declared dependencies. An import of something undeclared is a
    // different defect class (a missing dependency, which `verify` covers) and
    // folding it in here would conflate two findings.
    if (!declared.has(name)) continue;

    // Root-specifier, value-position claims only — a subpath has its own
    // surface, and a type-only import is erased before runtime.
    const referenced = [...pkgRefs.symbols.entries()]
      .filter(([sym, uses]) => {
        if (sym === 'default') return false;
        return uses.some((u) => SURFACE_CLAIM_KINDS.includes(u.via) && isRootSpecifier(u, name));
      })
      .map(([sym]) => sym)
      .sort();
    if (!referenced.length) continue;

    const installedDir = resolveInstalled(repo, name);
    const local = installedVersion(repo, name);
    let surface = null;
    let version = local ?? '';
    let source: PackageReplay['source'] = 'node_modules';

    if (installedDir) {
      surface = extractSurface(installedDir);
    } else if (opts.fetchMissing) {
      const spec = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? null;
      const fetched = await fetchAndExtract(name, spec && /^\d/.test(spec) ? spec : null);
      if (fetched) {
        surface = fetched.surface;
        version = fetched.resolvedVersion;
        source = 'registry';
      }
    }

    if (!surface) {
      skipped.push({ package: name, reason: 'not installed and not fetched' });
      continue;
    }
    if (surface.undeclaredReason) {
      // No readable surface is a measurement gap, never a set of missing
      // symbols — scoring against it would mark every reference a miss.
      skipped.push({ package: name, reason: `no readable surface: ${surface.undeclaredReason}` });
      continue;
    }

    const exported = new Set(runtimeSymbols(surface).map((s) => s.path));
    const bareValue = exported.size <= 1 && exported.has('default');
    if (bareValue) {
      skipped.push({ package: name, reason: 'exports a bare value, members are not module surface' });
      continue;
    }

    packages.push({
      package: name,
      version,
      source,
      referenced,
      missing: referenced.filter((s) => !exported.has(s)),
    });
  }

  const totalReferenced = packages.reduce((a, p) => a + p.referenced.length, 0);
  const totalMissing = packages.reduce((a, p) => a + p.missing.length, 0);
  return {
    repo,
    packages,
    skipped,
    filesScanned: refs.length,
    totalReferenced,
    totalMissing,
    missRate: totalReferenced ? totalMissing / totalReferenced : null,
    packagesReferenced: packages.length,
  };
}
