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

/** A subpath map keys entries by path (`"."`, `"./pg-core"`); a condition map
 *  keys them by condition (`"require"`, `"import"`). One dot tells them apart. */
function isSubpathMap(o: Record<string, unknown>): boolean {
  return Object.keys(o).some((k) => k.startsWith('.'));
}

/**
 * Match a subpath key against an `exports` pattern containing one `*`.
 * `./pg-core` against `./*` captures `pg-core`; the capture is substituted back
 * into the target, which is how `"./*": "./dist/*.js"` resolves.
 */
function matchWildcard(pattern: string, key: string): string | null {
  const star = pattern.indexOf('*');
  if (star === -1) return null;
  const pre = pattern.slice(0, star);
  const post = pattern.slice(star + 1);
  if (key.length < pre.length + post.length) return null;
  if (!key.startsWith(pre) || !key.endsWith(post)) return null;
  return key.slice(pre.length, key.length - post.length);
}

/**
 * Walk an `exports` value for one subpath key, preferring the conditions Node
 * actually uses for a CJS require, then ESM. Handles string, condition object,
 * subpath object, `./*` patterns, and arrays (first resolvable wins).
 *
 * `key` is `"."` for the package root and `"./pg-core"` for a subpath. Without
 * it this function could only ever answer for the root, which is why
 * `drizzle-orm/pg-core` had no surface to compare against and every symbol
 * imported from it went unchecked.
 */
function pickFromExports(exp: unknown, key = '.', depth = 0): string | null {
  if (depth > 8) return null;
  if (typeof exp === 'string') {
    // A bare string `exports` declares the root entry and nothing else.
    return key === '.' ? exp : null;
  }
  if (Array.isArray(exp)) {
    for (const e of exp) {
      const r = pickFromExports(e, key, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (!exp || typeof exp !== 'object') return null;
  const o = exp as Record<string, unknown>;

  if (isSubpathMap(o)) {
    if (key in o) return pickFromExports(o[key], '.', depth + 1);
    // Longest matching pattern wins, as Node does: `./lib/*` beats `./*`.
    const patterns = Object.keys(o)
      .filter((k) => k.includes('*'))
      .sort((a, b) => b.length - a.length);
    for (const p of patterns) {
      const capture = matchWildcard(p, key);
      if (capture === null) continue;
      const target = pickFromExports(o[p], '.', depth + 1);
      if (target) return target.split('*').join(capture);
    }
    return null;
  }

  // Condition map. `require` first: tier A reads shipped JS, and the CJS build
  // is the one whose surface a `require()` would see.
  for (const cond of ['require', 'node', 'default', 'import', 'module']) {
    if (cond in o) {
      const r = pickFromExports(o[cond], key, depth + 1);
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

/**
 * The file `require('<pkg>')` loads, or `require('<pkg>/<subpath>')` when a
 * subpath is given. Null when the package ships no usable JS entry there.
 *
 * A subpath entry point has its own export surface, unrelated to the root's:
 * `drizzle-orm/pg-core` exports `pgTable`, which `drizzle-orm` does not. Scoring
 * one against the other reports every symbol missing on correct code, so before
 * this the subpath refs were simply dropped instead, which reported *nothing*
 * missing on broken code. Both directions are wrong; resolving the real entry is
 * the only answer.
 */
export function resolveEntry(
  pkgDir: string,
  manifest?: PackageManifest | null,
  subpath?: string,
): string | null {
  const m = manifest ?? readManifest(pkgDir);
  if (!m) return null;
  const sub = subpath?.replace(/^\.?\//, '').replace(/\/$/, '');

  if (sub) {
    const fromExports =
      m.exports !== undefined ? pickFromExports(m.exports, `./${sub}`) : null;
    if (fromExports) return resolveFile(resolvePath(pkgDir, fromExports));
    // An `exports` map is a hard boundary in Node: a subpath it does not list
    // cannot be imported, so guessing at a file would invent a surface the
    // runtime refuses to load. Fall back to the filesystem only for the legacy
    // main/index layout, where any real file is genuinely reachable.
    if (m.exports !== undefined) return null;
    return resolveFile(resolvePath(pkgDir, sub));
  }

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
