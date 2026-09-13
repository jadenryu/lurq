/**
 * What a new version requires of the codebase beyond its API: here, the module
 * format `require()` gets.
 *
 * An upgrade can keep every export and still break at load. chalk 5, node-fetch
 * 3, got 12, execa 6: each went ESM-only, and each kept its API while
 * `require('<pkg>')` stopped working the way the calling code assumed. Nothing
 * in a surface diff sees that, tests often mock the module away, and the
 * failure arrives on first import in production.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import type { SymbolReference } from './references';
import type { RequireFormat } from './resolve';

/** Node lines where `require()` of an ES module works without a flag. */
const REQUIRE_ESM_NODE = '^20.19.0 || >=22.12.0';

export interface RepoRuntime {
  /** `engines.node` from the project's package.json. */
  engines?: string;
}

export function readRepoRuntime(rootDir: string): RepoRuntime {
  try {
    const manifest = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
      engines?: { node?: unknown };
    };
    return typeof manifest.engines?.node === 'string' ? { engines: manifest.engines.node } : {};
  } catch {
    return {};
  }
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
  ctx: { fromExports: Set<string> | null; toExports: Set<string> | null; runtime: RepoRuntime },
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
    for (const r of requireSites) add(r.file, r.line, 'the exports map no longer offers anything to require()');
  } else {
    for (const r of required) {
      if (r.via === 'default') {
        for (const c of r.calls ?? []) {
          if (c.args !== null) add(r.file, c.line, 'require() now returns the module namespace, which cannot be called');
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
        add(r.file, r.line, `\`${r.symbol}\` is not an export of the ES module, so it reads as undefined`);
      }
    }
  }

  const olderNode =
    to === 'esm' && !requireEsmGuaranteed(ctx.runtime)
      ? [...new Map(requireSites.map((r) => [`${r.file}:${r.line}`, { file: r.file, line: r.line }])).values()]
      : [];

  if (!broken.size && !olderNode.length) return null;
  return { from, to, broken: [...broken.values()], olderNode };
}
