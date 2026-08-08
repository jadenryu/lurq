/**
 * Entry-point and specifier resolution for tier-A extraction (§6.2).
 *
 * Two jobs, both boring and both load-bearing:
 *   1. Find the file `require('pkg')` actually loads: exports map → main → index.js
 *   2. Decide whether a specifier stays inside the package (recurse into it) or
 *      leaves it (record as external, per defect §6.4.1)
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';

const EXTENSIONS = ['.js', '.cjs', '.mjs', '.json'];

export interface PackageManifest {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  peerDependencies?: Record<string, string>;
}

export function readManifest(pkgDir: string): PackageManifest | null {
  const p = join(pkgDir, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}


/** The conditions tier A will read an entry from, best first. */
const CONDITIONS = ['require', 'node', 'default', 'import', 'module'] as const;

/**
 * Every root entry an `exports` map offers, in condition order.
 *
 * Same walk as pickFromExports, collecting rather than short-circuiting, so a
 * caller whose first choice extracted nothing has the remaining conditions to
 * try. Duplicates are fine here — resolveEntryCandidates dedupes on the
 * resolved path, which is what actually has to be distinct.
 */
function pickAllFromExports(exp: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof exp === 'string') return [exp];
  if (Array.isArray(exp)) return exp.flatMap((e) => pickAllFromExports(e, depth + 1));
  if (!exp || typeof exp !== 'object') return [];
  const o = exp as Record<string, unknown>;
  if ('.' in o) return pickAllFromExports(o['.'], depth + 1);
  return CONDITIONS.filter((c) => c in o).flatMap((c) => pickAllFromExports(o[c], depth + 1));
}

/** Resolve a file path, trying extensions and directory index files. */
export function resolveFile(candidate: string): string | null {
  if (existsSync(candidate)) {
    try {
      if (statSync(candidate).isFile()) return candidate;
      // directory → index.*
      for (const ext of EXTENSIONS) {
        const idx = join(candidate, `index${ext}`);
        if (existsSync(idx) && statSync(idx).isFile()) return idx;
      }
    } catch {
      return null;
    }
  }
  for (const ext of EXTENSIONS) {
    const withExt = `${candidate}${ext}`;
    if (existsSync(withExt)) return withExt;
  }
  return null;
}

/** The file `require('<pkg>')` loads. Null when the package ships no usable JS entry. */
export function resolveEntry(pkgDir: string, manifest?: PackageManifest | null): string | null {
  return resolveEntryCandidates(pkgDir, manifest)[0] ?? null;
}

/**
 * Every entry this package could reasonably be read from, best first.
 *
 * `resolveEntry` returns only the winner, which is right until the winner turns
 * out to be unreadable. An ESM-first package ships a `require` condition that is
 * a thin CJS wrapper — it re-exports through a runtime call the AST walker
 * cannot follow, so extraction resolves an entry, walks one file, and finds zero
 * exports. date-fns and vitest both did exactly that, and the result was not an
 * error: `usage` and `diff_surface` returned an empty surface for two packages
 * with hundreds of exports between them, which reads as "this package has no
 * API" rather than "we could not read it".
 *
 * So the caller gets the whole ordered list and can move on when a candidate
 * comes back empty. The order is unchanged — `require` still wins for the CJS
 * packages it was chosen for, and nothing that already extracted cleanly takes a
 * different path. This only adds somewhere to go when the first door is shut.
 */
export function resolveEntryCandidates(
  pkgDir: string,
  manifest?: PackageManifest | null,
): string[] {
  const m = manifest ?? readManifest(pkgDir);
  if (!m) return [];
  const specifiers = [
    ...(m.exports !== undefined ? pickAllFromExports(m.exports) : []),
    m.main ?? null,
    m.module ?? null,
    './index.js',
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);

  const out: string[] = [];
  for (const c of specifiers) {
    const hit = resolveFile(resolvePath(pkgDir, c));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/**
 * Does this specifier stay inside the package?
 *
 * Relative specifiers do. A bare specifier (`@smithy/types`, `lodash`) does not,
 * and its names must be recorded with `origin: external:*` rather than counted as
 * this package's runtime surface — defect §6.4.1, the one that produced a phantom
 * 168-export deletion.
 */
export function resolvesInsidePackage(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';
}

/** Resolve a relative specifier from `fromFile`, refusing to escape `pkgDir`. */
export function resolveInternal(
  fromFile: string,
  spec: string,
  pkgDir: string,
): string | null {
  const target = resolvePath(dirname(fromFile), spec);
  const root = resolvePath(pkgDir);
  // Escaping the package root means it isn't this package's surface.
  if (target !== root && !target.startsWith(root + sep)) return null;
  return resolveFile(target);
}
