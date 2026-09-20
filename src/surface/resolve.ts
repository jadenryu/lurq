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
  type?: string;
  engines?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
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
 * Every entry an `exports` map offers for one subpath key, in condition order.
 *
 * Collecting rather than short-circuiting, so a caller whose first choice
 * extracted nothing has the remaining conditions to try. Duplicates are fine
 * here — resolveEntryCandidates dedupes on the resolved path, which is what
 * actually has to be distinct.
 *
 * `key` is `"."` for the package root and `"./pg-core"` for a subpath. Without
 * it this could only ever answer for the root, which is why
 * `drizzle-orm/pg-core` had no surface to compare against and every symbol
 * imported from it went unchecked.
 */
function pickAllFromExports(exp: unknown, key = '.', depth = 0): string[] {
  if (depth > 8) return [];
  // A bare string `exports` declares the root entry and nothing else.
  if (typeof exp === 'string') return key === '.' ? [exp] : [];
  if (Array.isArray(exp)) return exp.flatMap((e) => pickAllFromExports(e, key, depth + 1));
  if (!exp || typeof exp !== 'object') return [];
  const o = exp as Record<string, unknown>;

  if (isSubpathMap(o)) {
    if (key in o) return pickAllFromExports(o[key], '.', depth + 1);
    // Longest matching pattern wins, as Node does: `./lib/*` beats `./*`.
    const patterns = Object.keys(o)
      .filter((k) => k.includes('*'))
      .sort((a, b) => b.length - a.length);
    for (const p of patterns) {
      const capture = matchWildcard(p, key);
      if (capture === null) continue;
      const targets = pickAllFromExports(o[p], '.', depth + 1);
      if (targets.length) return targets.map((t) => t.split('*').join(capture));
    }
    return [];
  }
  return CONDITIONS.filter((c) => c in o).flatMap((c) => pickAllFromExports(o[c], key, depth + 1));
}

/** Resolve a file path, trying extensions and directory index files. */
export function resolveFile(candidate: string, depth = 0): string | null {
  if (existsSync(candidate)) {
    try {
      if (statSync(candidate).isFile()) return candidate;
      // A directory with its own package.json loads its `main`, as Node's
      // require does. Packages use it to keep `pkg/sub` importable after moving
      // the file (`sub/package.json` → `../dist/sub.js`); missing it reports a
      // working deep import as withdrawn.
      const main = depth < 4 ? readManifest(candidate)?.main : undefined;
      if (main) {
        const hit = resolveFile(resolvePath(candidate, main), depth + 1);
        if (hit) return hit;
      }
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
 */
export function resolveEntry(
  pkgDir: string,
  manifest?: PackageManifest | null,
  subpath?: string,
): string | null {
  return resolveEntryCandidates(pkgDir, manifest, subpath)[0] ?? null;
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
 *
 * With a `subpath`, the same list for that entry point instead. A subpath entry
 * has its own export surface, unrelated to the root's: `drizzle-orm/pg-core`
 * exports `pgTable`, which `drizzle-orm` does not. Scoring one against the other
 * reports every symbol missing on correct code, so those references used to be
 * dropped instead, which reported nothing missing on broken code. Both
 * directions are wrong; resolving the real entry is the only answer, and it
 * inherits the same unreadable-candidate fallback the root gets.
 */
export function resolveEntryCandidates(
  pkgDir: string,
  manifest?: PackageManifest | null,
  subpath?: string,
): string[] {
  const m = manifest ?? readManifest(pkgDir);
  if (!m) return [];
  const sub = subpath?.replace(/^\.?\//, '').replace(/\/$/, '');
  const specifiers = (
    sub
      ? // An `exports` map is a hard boundary in Node: a subpath it does not
        // list cannot be imported, so guessing at a file would invent a surface
        // the runtime refuses to load. The bare path is offered only for the
        // legacy main/index layout, where any real file is genuinely reachable.
        m.exports !== undefined
        ? pickAllFromExports(m.exports, `./${sub}`)
        : [`./${sub}`]
      : [
          ...(m.exports !== undefined ? pickAllFromExports(m.exports) : []),
          m.main ?? null,
          m.module ?? null,
          './index.js',
        ]
  ).filter((c): c is string => typeof c === 'string' && c.length > 0);

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
export function resolveInternal(fromFile: string, spec: string, pkgDir: string): string | null {
  const target = resolvePath(dirname(fromFile), spec);
  const root = resolvePath(pkgDir);
  // Escaping the package root means it isn't this package's surface.
  if (target !== root && !target.startsWith(root + sep)) return null;
  return resolveFile(target);
}

/**
 * What `require('<pkg>')` gets, by Node's rules rather than tier A's.
 *
 *   cjs         a CommonJS file
 *   esm         an ES module. `require()` of it works on Node 20.19+ and 22.12+
 *               and returns the module namespace; older Node throws ERR_REQUIRE_ESM
 *   unexported  the `exports` map offers `require` nothing (ERR_PACKAGE_PATH_NOT_EXPORTED)
 */
export type RequireFormat = 'cjs' | 'esm' | 'unexported';

// `module-sync` is Node's condition for an ES module that require() can load
// (20.19+, 22.10+). A package offering only it and `import` is not unexported.
const REQUIRE_CONDITIONS = new Set(['require', 'module-sync', 'node', 'node-addons', 'default']);

/**
 * Tier A reads whichever entry yields a surface, `import` conditions included,
 * because it asks what the package exports. This asks what a CommonJS caller is
 * handed, so it walks `exports` in the map's own key order, as Node does, with
 * only the conditions `require` matches, then reads the file's format from its
 * extension or the nearest package.json. Null when nothing resolves.
 */
export function requireFormat(
  pkgDir: string,
  manifest?: PackageManifest | null,
): RequireFormat | null {
  return requireTarget(pkgDir, manifest)?.format ?? null;
}

/** `requireFormat` together with the file `require()` loads; `file` is null when
 *  nothing is offered to it. */
export function requireTarget(
  pkgDir: string,
  manifest?: PackageManifest | null,
): { format: RequireFormat; file: string | null } | null {
  const m = manifest ?? readManifest(pkgDir);
  if (!m) return null;
  let target: string | null;
  if (m.exports !== undefined) {
    target = nodeRequireTarget(rootExport(m.exports));
    if (!target) return { format: 'unexported', file: null };
  } else {
    target = m.main ?? './index.js';
  }
  const file = resolveFile(resolvePath(pkgDir, target));
  if (!file) return null;
  const format: RequireFormat = file.endsWith('.mjs')
    ? 'esm'
    : file.endsWith('.cjs') || file.endsWith('.json') || file.endsWith('.node')
      ? 'cjs'
      : nearestPackageType(file, pkgDir) === 'module'
        ? 'esm'
        : 'cjs';
  return { format, file };
}

/** The root entry of an `exports` value: `"."` of a subpath map, or the value itself. */
function rootExport(exp: unknown): unknown {
  if (
    exp &&
    typeof exp === 'object' &&
    !Array.isArray(exp) &&
    isSubpathMap(exp as Record<string, unknown>)
  ) {
    return (exp as Record<string, unknown>)['.'];
  }
  return exp;
}

/** The first target Node's resolver picks for `require`, conditions in key order. */
function nodeRequireTarget(exp: unknown, depth = 0): string | null {
  if (depth > 8 || exp === null || exp === undefined) return null;
  if (typeof exp === 'string') return exp;
  if (Array.isArray(exp)) {
    for (const e of exp) {
      const t = nodeRequireTarget(e, depth + 1);
      if (t) return t;
    }
    return null;
  }
  if (typeof exp !== 'object') return null;
  for (const [condition, value] of Object.entries(exp as Record<string, unknown>)) {
    if (!REQUIRE_CONDITIONS.has(condition)) continue;
    const t = nodeRequireTarget(value, depth + 1);
    if (t) return t;
  }
  return null;
}

/** `type` of the nearest package.json at or above `file`. Node reads the nearest
 *  one whether or not it sets `type`, which is how `dist/cjs/package.json` works. */
function nearestPackageType(file: string, pkgDir: string): string | undefined {
  const root = resolvePath(pkgDir);
  for (let dir = dirname(file); dir.startsWith(root); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        return (JSON.parse(readFileSync(manifest, 'utf8')) as { type?: string }).type;
      } catch {
        return undefined;
      }
    }
    if (dir === root || dirname(dir) === dir) break;
  }
  return undefined;
}

/**
 * Has the package stopped offering `./<sub>` to a runtime loader at all?
 *
 * True when nothing resolves for it and nothing still claims it: no `exports`
 * map (the legacy layout, where the file is simply gone), a map that no longer
 * lists it, or a map that lists it at a file the tarball does not contain. A
 * subpath still listed only under conditions tier A does not read (`types`,
 * `browser`) is not withdrawn, and calling it withdrawn would block a PR on
 * working code.
 */
export function subpathWithdrawn(
  pkgDir: string,
  manifest: PackageManifest | null,
  sub: string,
): boolean {
  const m = manifest ?? readManifest(pkgDir);
  if (!m) return false;
  if (resolveEntryCandidates(pkgDir, m, sub).length) return false;
  if (m.exports === undefined) return true;
  const key = `./${sub.replace(/^\.?\//, '').replace(/\/$/, '')}`;
  return !exportsDeclares(m.exports, key) || pickAllFromExports(m.exports, key).length > 0;
}

/** Does an `exports` map name this subpath key, directly or through a pattern? */
function exportsDeclares(exp: unknown, key: string): boolean {
  if (!exp || typeof exp !== 'object' || Array.isArray(exp)) return key === '.';
  const o = exp as Record<string, unknown>;
  if (!isSubpathMap(o)) return key === '.';
  return key in o || Object.keys(o).some((p) => p.includes('*') && matchWildcard(p, key) !== null);
}
