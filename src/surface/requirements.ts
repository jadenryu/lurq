/**
 * What a new version requires of the codebase beyond its API: the module format
 * `require()` gets, the Node it runs on, and the peers it expects beside it.
 *
 * An upgrade can keep every export and still break at load. chalk 5, node-fetch
 * 3, got 12, execa 6: each went ESM-only, and each kept its API while
 * `require('<pkg>')` stopped working the way the calling code assumed. Nothing
 * in a surface diff sees that, tests often mock the module away, and the
 * failure arrives on first import in production.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import semver from 'semver';
import { resolveRuntimeEngineConflicts } from '../compat/peerCompat';
import type { SymbolReference } from './references';
import type { PackageManifest, RequireFormat } from './resolve';

/** Node lines where `require()` of an ES module works without a flag. */
const REQUIRE_ESM_NODE = '^20.19.0 || >=22.12.0';

export interface RepoRuntime {
  /** `engines.node` from the project's package.json: every Node it claims to support. */
  engines?: string;
  /** `.nvmrc` or `.node-version`: the Node developers and CI actually run. */
  nodeVersionFile?: { name: string; value: string };
  /** The project root, for looking up which version of a peer it has. */
  root?: string;
}

export function readRepoRuntime(rootDir: string): RepoRuntime {
  const runtime: RepoRuntime = { root: rootDir };
  try {
    const manifest = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
      engines?: { node?: unknown };
    };
    if (typeof manifest.engines?.node === 'string') runtime.engines = manifest.engines.node;
  } catch {
    // No readable manifest: nothing declared, nothing to judge against.
  }
  for (const name of ['.nvmrc', '.node-version']) {
    try {
      const value = readFileSync(join(rootDir, name), 'utf8').trim();
      if (value) {
        runtime.nodeVersionFile = { name, value };
        break;
      }
    } catch {
      // Absent is the common case.
    }
  }
  return runtime;
}

/** Does every Node the project declares support `require(esm)`? Unknown is no. */
function requireEsmGuaranteed(runtime: RepoRuntime): boolean {
  if (!runtime.engines || !semver.validRange(runtime.engines)) return false;
  try {
    return semver.subset(runtime.engines, REQUIRE_ESM_NODE);
  } catch {
    return false;
  }
}

export interface Site {
  file: string;
  line: number;
}

export interface RequireBreak {
  from: RequireFormat;
  to: RequireFormat;
  /** Uses that fail on every Node version. BLOCKING. */
  broken: (Site & { why: string })[];
  /** `require()` sites that throw ERR_REQUIRE_ESM on Node before 20.19 / 22.12.
   *  Empty when the project's `engines.node` already rules those out. */
  olderNode: Site[];
}

/**
 * Judge the root entry's `require()` uses across a module-format change.
 *
 * `fromExports`/`toExports` are the runtime export names on each side, null when
 * a side could not be read, in which case the missing-export judgement is
 * skipped rather than guessed: an unreadable surface would make every property
 * look missing.
 */
export function judgeRequires(
  from: RequireFormat | null,
  to: RequireFormat | null,
  refs: SymbolReference[],
  ctx: {
    fromExports: Set<string> | null;
    toExports: Set<string> | null;
    runtime: RepoRuntime;
    /** The new ES module's own graph uses top-level await. */
    asyncModule?: boolean;
  },
): RequireBreak | null {
  if (from !== 'cjs' || to === null || to === 'cjs') return null;
  const required = refs.filter((r) => r.loader === 'require');
  if (!required.length) return null;

  // Where `require` itself runs: the binding or destructuring line, or an inline
  // `require('pkg').x` in a file that has no binding for it.
  const bindingFiles = new Set(required.filter((r) => r.via !== 'namespace').map((r) => r.file));
  const requireSites = required.filter((r) => r.via !== 'namespace' || !bindingFiles.has(r.file));

  const broken = new Map<string, Site & { why: string }>();
  const add = (file: string, line: number, why: string) => {
    if (!broken.has(`${file}:${line}`)) broken.set(`${file}:${line}`, { file, line, why });
  };

  if (to === 'unexported') {
    for (const r of requireSites)
      add(r.file, r.line, 'the exports map no longer offers anything to require()');
  } else if (ctx.asyncModule) {
    for (const r of requireSites) {
      add(
        r.file,
        r.line,
        'the ES module uses top-level await, so require() throws ERR_REQUIRE_ASYNC_MODULE on every Node',
      );
    }
  } else {
    for (const r of required) {
      if (r.via === 'default') {
        for (const c of r.calls ?? []) {
          if (c.args !== null)
            add(
              r.file,
              c.line,
              'require() now returns the module namespace, which cannot be called',
            );
        }
      } else if (
        (r.via === 'namespace' || r.via === 'destructured') &&
        ctx.fromExports &&
        ctx.toExports &&
        !ctx.fromExports.has(r.symbol) &&
        !ctx.toExports.has(r.symbol)
      ) {
        // A property of the old CommonJS value, not an export of it, and not an
        // export of the ES module either. A name the old version did export and
        // the new one dropped is already reported as a removed symbol.
        add(
          r.file,
          r.line,
          `\`${r.symbol}\` is not an export of the ES module, so it reads as undefined`,
        );
      }
    }
  }

  const olderNode =
    to === 'esm' && !ctx.asyncModule && !requireEsmGuaranteed(ctx.runtime)
      ? [
          ...new Map(
            requireSites.map((r) => [`${r.file}:${r.line}`, { file: r.file, line: r.line }]),
          ).values(),
        ]
      : [];

  if (!broken.size && !olderNode.length) return null;
  return { from, to, broken: [...broken.values()], olderNode };
}

export interface Requirement {
  kind: 'engines' | 'peer';
  /** `node`, or the peer's package name. */
  name: string;
  /** The range the new version asks for. */
  needs: string;
  /** What the project has, and where that was read from. */
  has: string;
}

/** `inner` ⊆ `outer`, or null when semver cannot say. */
function subsetOf(inner: string, outer: string): boolean | null {
  try {
    return semver.subset(inner, outer);
  } catch {
    return null;
  }
}

/**
 * Node and peer versions the new release asks for that this project does not
 * provide, and that the old release did not already ask for.
 *
 * Only what the upgrade changed is reported. A project already outside the old
 * version's range has a real problem, but not one this upgrade caused, and
 * reporting it here would attach it to the wrong PR. Every judgement that
 * semver cannot make comes back as "no requirement", never as a conflict.
 */
export function judgeRequirements(
  from: PackageManifest | null,
  to: PackageManifest | null,
  runtime: RepoRuntime,
): Requirement[] {
  if (!to) return [];
  return [...engineRequirements(from, to, runtime), ...peerRequirements(from, to, runtime)];
}

function engineRequirements(
  from: PackageManifest | null,
  to: PackageManifest,
  runtime: RepoRuntime,
): Requirement[] {
  const needs = to.engines?.node;
  const before = from?.engines?.node;
  if (!needs || !semver.validRange(needs) || needs === before) return [];
  const out: Requirement[] = [];

  // Every Node the project says it supports has to satisfy the package.
  const declared = runtime.engines;
  if (declared && semver.validRange(declared) && subsetOf(declared, needs) === false) {
    const alreadyOut = before && semver.validRange(before) && subsetOf(declared, before) === false;
    if (!alreadyOut)
      out.push({ kind: 'engines', name: 'node', needs, has: `${declared} (package.json engines)` });
  }

  // The pinned Node, judged as the compat check judges it: `20` is some Node
  // 20, not 20.0.0, so a floor inside that line is not a conflict.
  const pinned = runtime.nodeVersionFile;
  if (pinned) {
    const conflicts = (range: string | undefined) =>
      Boolean(range) &&
      resolveRuntimeEngineConflicts(
        [
          {
            name: to.name ?? 'package',
            version: null,
            peerDependencies: null,
            peerDependenciesMeta: null,
            engines: { node: range! },
          },
        ],
        pinned.value,
      ).length > 0;
    if (conflicts(needs) && !conflicts(before)) {
      out.push({ kind: 'engines', name: 'node', needs, has: `${pinned.value} (${pinned.name})` });
    }
  }
  return out;
}

function peerRequirements(
  from: PackageManifest | null,
  to: PackageManifest,
  runtime: RepoRuntime,
): Requirement[] {
  if (!runtime.root) return [];
  const out: Requirement[] = [];
  for (const [peer, needs] of Object.entries(to.peerDependencies ?? {})) {
    if (to.peerDependenciesMeta?.[peer]?.optional || !semver.validRange(needs)) continue;
    const before = from?.peerDependencies?.[peer];
    if (needs === before) continue;
    // A peer the project does not have is one the package manager installs.
    const has = projectVersionOf(runtime.root, peer);
    if (!has) continue;
    const fits = (range: string) => {
      try {
        return has.exact
          ? semver.satisfies(has.version, range)
          : semver.intersects(has.version, range);
      } catch {
        return true;
      }
    };
    if (fits(needs)) continue;
    if (before && semver.validRange(before) && !fits(before)) continue;
    out.push({ kind: 'peer', name: peer, needs, has: `${has.version} (${has.source})` });
  }
  return out;
}

/**
 * The version of `name` this project has: the installed one when it is
 * installed, which is exact, otherwise the range its package.json declares.
 * The walk up stops at the repository root, so a stray `~/node_modules` is
 * never mistaken for the project's own install.
 */
function projectVersionOf(
  root: string,
  name: string,
): { version: string; exact: boolean; source: string } | null {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    try {
      const { version } = JSON.parse(
        readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8'),
      ) as {
        version?: string;
      };
      if (version && semver.valid(version)) return { version, exact: true, source: 'installed' };
    } catch {
      // Not installed at this level.
    }
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) break;
  }
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
    if (declared && semver.validRange(declared))
      return { version: declared, exact: false, source: 'package.json' };
  } catch {
    // No manifest to read.
  }
  return null;
}
