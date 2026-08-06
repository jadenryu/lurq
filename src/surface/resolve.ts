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

/**
 * Walk an `exports` value for the "." entry, preferring the conditions Node
 * actually uses for a CJS require, then ESM. Handles string, condition object,
 * subpath object, and arrays (first resolvable wins).
 */
function pickFromExports(exp: unknown, depth = 0): string | null {
  if (depth > 8) return null;
  if (typeof exp === 'string') return exp;
  if (Array.isArray(exp)) {
    for (const e of exp) {
      const r = pickFromExports(e, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (!exp || typeof exp !== 'object') return null;
  const o = exp as Record<string, unknown>;
  // Subpath map: the root entry is "."
  if ('.' in o) return pickFromExports(o['.'], depth + 1);
  // Condition map. `require` first: tier A reads shipped JS, and the CJS build
  // is the one whose surface a `require()` would see.
  for (const cond of ['require', 'node', 'default', 'import', 'module']) {
    if (cond in o) {
      const r = pickFromExports(o[cond], depth + 1);
      if (r) return r;
    }
  }
  return null;
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
  const m = manifest ?? readManifest(pkgDir);
  if (!m) return null;
  const candidates = [
    m.exports !== undefined ? pickFromExports(m.exports) : null,
    m.main ?? null,
    './index.js',
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);

  for (const c of candidates) {
    const hit = resolveFile(resolvePath(pkgDir, c));
    if (hit) return hit;
  }
  return null;
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
