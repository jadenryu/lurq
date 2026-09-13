/**
 * Reference scanner (§9.1) — what symbols does this codebase actually use from
 * each dependency, and at which file:line.
 *
 * This is the half of `check_upgrade` that makes the check COVERAGE-INDEPENDENT,
 * and it is the whole wedge: Renovate and Dependabot gate an upgrade on your test
 * suite, so an uncovered path merges green and breaks later. Comparing what the
 * code *references* against what the target version *exports* needs no tests at
 * all.
 *
 * Static and conservative by construction. It resolves what an import binds and
 * which properties are read off it; it does not attempt dynamic access
 * (`pkg[name]`), which is reported nowhere rather than guessed at — a false
 * "you use this" is a false blocking result, and a CI check that cries wolf gets
 * disabled inside two weeks (§12 M3's kill condition).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';

const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);

/**
 * How the symbol was reached — which decides whether it is a claim about the
 * MODULE'S EXPORT SURFACE or about a property of an exported value.
 *
 *   named / destructured / namespace  → a real export claim; tier A can verify
 *   default                           → the module itself
 *   default-member                    → a property of the default export's VALUE
 *
 * The last one is the important distinction. `chalk.bold` is correct chalk usage
 * but `bold` is not a module export, so scoring it against a tier-A surface
 * reports a miss on working code. Doing that in check_upgrade would block a PR
 * on valid code, which is how a CI gate gets switched off (§12 M3).
 */
export type ReferenceVia =
  | 'named'
  | 'destructured'
  | 'namespace'
  | 'default'
  | 'default-member'
  /**
   * A property read off a NAMED import: `import { z } from 'zod'` then
   * `z.string()`. Conditional, which is why it is not in SURFACE_CLAIM_KINDS.
   *
   * Some packages export a namespace-shaped object alongside the same names at
   * the top level, and zod is the canonical one: `z.string` and the top-level
   * `string` export are the same function. For those, the member IS checkable
   * against the module surface. For a named export that is merely an object
   * with its own unrelated properties, it is not, and conflating the two would
   * block a PR on correct code. The scorer decides using the parent's kind,
   * which only it can see; the scanner records the fact and the parent name.
   */
  | 'named-member'
  /** Erased by TypeScript before runtime — never a runtime-surface claim. */
  | 'type-only'
  /**
   * `import 'pkg/register'` or a bare `require('pkg/setup')`: loads the module
   * and claims none of its exports. Still a break site when the entry point is
   * withdrawn, or when `require()` can no longer load it.
   */
  | 'side-effect';

export interface CallSite {
  line: number;
  /** Arguments passed, or null when they cannot be counted: a spread argument,
   *  or a use that is not a call at all (passed as a callback, stored, exported). */
  args: number | null;
}

export interface SymbolReference {
  /** Exported name used from the package. 'default' for a default import. */
  symbol: string;
  via: ReferenceVia;
  /** Only on `named-member`: the named export the property was read from. */
  parent?: string;
  /**
   * The full import specifier. A subpath (`drizzle-orm/pg-core`) has its OWN
   * entry point and its own surface — scoring its symbols against the package
   * ROOT reports every one of them missing, on correct code.
   */
  specifier: string;
  file: string;
  line: number;
  /**
   * The uses this reference leads to. A named import or destructured require
   * gets every use of its local name in the file; a member read gets itself.
   * Absent means the scanner did not follow it, which an arity check must
   * treat as unmeasured rather than as unused.
   */
  calls?: CallSite[];
  /** Set when the module was loaded with `require()`, TypeScript's
   *  `import x = require()` included. That is what an ESM-only release breaks. */
  loader?: 'require';
}

/** Kinds that assert something about the module's own export surface. */
export const SURFACE_CLAIM_KINDS: ReferenceVia[] = ['named', 'destructured', 'namespace'];

/** True when the reference is against the package root rather than a subpath. */
export function isRootSpecifier(ref: SymbolReference, pkg: string): boolean {
  return ref.specifier === pkg;
}

export interface PackageReferences {
  package: string;
  symbols: Map<string, SymbolReference[]>;
}

/** Bare specifier → package name (`@scope/pkg/sub` → `@scope/pkg`). */
export function packageOfSpecifier(spec: string): string | null {
  if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
  if (spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * Source files, asking git rather than guessing at directory names.
 *
 * SKIP_DIRS is a fixed list — `dist`, `build`, `out` — and a build output
 * directory called anything else gets walked as if it were source. lurq's own
 * repo is the proof: tsup writes to `dist-operator` (tsup.config.ts), which is
 * not on the list, so scanning this project reported symbols at
 * `dist-operator/chunk-OX3TLAEA.js:12` — a generated file nobody edits, and a
 * citation nobody can act on. Reading tsconfig's `outDir` would not have caught
 * it either, since the path is declared by the bundler, not the compiler.
 *
 * Widening the list is the wrong repair: `lib`, `es` and `esm` are build output
 * in some projects and hand-written source in others, so any name-based guess
 * either misses output or silently drops real code. The second failure is much
 * worse than the first — a missed call site turns a blocking upgrade into a
 * clean one.
 *
 * `git ls-files --cached --others --exclude-standard` is exactly the question
 * being asked: the files this project treats as its own, tracked or newly
 * written, excluding everything its own ignore rules call generated. One
 * subprocess, no glob parsing, and it uses the project's declaration rather
 * than our guess about it.
 *
 * The walk stays as the fallback, because a directory that is not a git
 * checkout still has to be scannable.
 */
function listSourceFiles(dir: string, limit = 5000): SourceListing {
  const tracked = gitSourceFiles(dir, limit);
  if (tracked) return tracked;

  const out: string[] = [];
  let truncated = false;
  const walk = (d: string) => {
    if (truncated) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      if (truncated) return;
      if (SKIP_DIRS.has(e) || e.startsWith('.')) continue;
      const full = join(d, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (SOURCE_EXT.has(extname(e)) && !e.endsWith('.d.ts')) {
        if (out.length >= limit) truncated = true;
        else out.push(full);
      }
    }
  };
  walk(dir);
  return { files: out, truncated };
}

/**
 * `truncated` means a source file exists past the limit. A caller that ignores
 * it reports on files it never opened, so a check that must not claim "safe"
 * without looking has to surface it.
 */
interface SourceListing {
  files: string[];
  truncated: boolean;
}

/** Source files per git, or null when `dir` is not a usable checkout. */
function gitSourceFiles(dir: string, limit: number): SourceListing | null {
  let stdout: string;
  try {
    stdout = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // not a repo, or git is unavailable, walk instead
  }

  const out: string[] = [];
  for (const rel of stdout.split('\n')) {
    if (!rel) continue;
    if (!SOURCE_EXT.has(extname(rel)) || rel.endsWith('.d.ts')) continue;
    // node_modules can be committed; it is never the project's own source.
    if (rel.split('/').includes('node_modules')) continue;
    if (out.length >= limit) return { files: out, truncated: true };
    out.push(join(dir, rel));
  }
  return { files: out, truncated: false };
}

/**
 * The module a loading expression names: `require('x')`, `await import('x')`,
 * or either wrapped in parentheses. Null for anything else, including an
 * un-awaited `import('x')`, whose value is a promise rather than the module.
 */
function loadedModule(expr: ts.Expression): { spec: string; loader: 'require' | 'import' } | null {
  let e: ts.Expression = expr;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  const awaited = ts.isAwaitExpression(e);
  if (awaited) e = (e as ts.AwaitExpression).expression;
  if (!ts.isCallExpression(e) || e.arguments.length !== 1) return null;
  const arg = e.arguments[0]!;
  if (!ts.isStringLiteralLike(arg)) return null;
  if (e.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return awaited ? { spec: arg.text, loader: 'import' } : null;
  }
  if (ts.isIdentifier(e.expression) && e.expression.text === 'require') {
    return { spec: arg.text, loader: 'require' };
  }
  return null;
}

/** What the use at `node` is: a call and its argument count, or anything else. */
function callSiteOf(sf: ts.SourceFile, node: ts.Node): CallSite {
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const p = node.parent;
  if (p && (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === node) {
    const args = p.arguments ?? [];
    return { line, args: args.some(ts.isSpreadElement) ? null : args.length };
  }
  return { line, args: null };
}

/** Is this identifier a read of a binding, rather than a name being declared? */
function isValueUse(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  if (ts.isImportEqualsDeclaration(p) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false;
  if (ts.isExportSpecifier(p) && p.name === id && p.propertyName) return false;
  const declares =
    ts.isVariableDeclaration(p) ||
    ts.isParameter(p) ||
    ts.isFunctionDeclaration(p) ||
    ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) ||
    ts.isClassExpression(p) ||
    ts.isPropertyAssignment(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isGetAccessor(p) ||
    ts.isSetAccessor(p) ||
    ts.isEnumMember(p);
  return !(declares && (p as { name?: ts.Node }).name === id);
}

/**
 * Every value use of the given local names in a file.
 *
 * ponytail: scope-blind. A parameter that shadows an import is counted as a use
 * of the import, which can add a call to judge (at worst a spurious warning) but
 * never removes one. A scope-aware pass means a binder; the type check already
 * judges TypeScript files exactly, so this only has to be good for plain JS.
 */
function valueUses(sf: ts.SourceFile, locals: Set<string>): Map<string, CallSite[]> {
  const out = new Map<string, CallSite[]>();
  const visit = (node: ts.Node, inType: boolean): void => {
    const nowInType = inType || ts.isTypeNode(node);
    if (!nowInType && ts.isIdentifier(node) && locals.has(node.text) && isValueUse(node)) {
      const list = out.get(node.text);
      if (list) list.push(callSiteOf(sf, node));
      else out.set(node.text, [callSiteOf(sf, node)]);
    }
    ts.forEachChild(node, (c) => visit(c, nowInType));
  };
  visit(sf, false);
  return out;
}

/**
 * Scan a codebase for the symbols it uses from each bare-specifier import.
 *
 * Namespace and default bindings are tracked so member reads resolve to the
 * right package: `import fg from 'fast-glob'` + `fg.escapePath` records
 * `escapePath`, which is what makes the §9.0 report able to name a line.
 */

/**
 * Identifiers that appear in VALUE position.
 *
 * TypeScript erases imports used only as types, so a named import that never
 * appears in a value position asserts nothing about the runtime surface. This
 * is a syntactic approximation — no type checker — which is the right bias:
 * treating a genuine value use as type-only would UNDER-report, and a missed
 * detection is far cheaper than a false "this symbol does not exist".
 */
function collectValueIdentifiers(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node, inType: boolean): void => {
    const nowInType = inType || ts.isTypeNode(node) || ts.isTypeQueryNode(node);
    if (
      !nowInType &&
      ts.isIdentifier(node) &&
      node.parent &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isImportClause(node.parent) &&
      !ts.isNamespaceImport(node.parent) &&
      !ts.isPropertyAccessExpression(node.parent)
    ) {
      out.add(node.text);
    }
    // A property access still uses its OBJECT in value position.
    if (!nowInType && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      out.add(node.expression.text);
    }
    ts.forEachChild(node, (c) => visit(c, nowInType));
  };
  visit(sf, false);
  return out;
}

export function scanReferences(
  rootDir: string,
  opts: {
    limit?: number;
    /** Filled in with how much was read. `truncated` is set when files past `limit` were skipped. */
    stats?: { files: number; truncated: boolean };
  } = {},
): PackageReferences[] {
  const byPackage = new Map<string, Map<string, SymbolReference[]>>();

  const record = (
    pkg: string,
    symbol: string,
    via: ReferenceVia,
    specifier: string,
    file: string,
    line: number,
    parent?: string,
    call?: CallSite,
  ): SymbolReference => {
    let syms = byPackage.get(pkg);
    if (!syms) byPackage.set(pkg, (syms = new Map()));
    const list = syms.get(symbol);
    const ref: SymbolReference = {
      symbol,
      via,
      specifier,
      file,
      line,
      ...(parent ? { parent } : {}),
      ...(call ? { calls: [call] } : {}),
    };
    if (!list) {
      syms.set(symbol, [ref]);
      return ref;
    }
    // Same file:line can legitimately carry two different claims (`z` as a
    // named import, `z.string` as a member read off it), so the dedupe key
    // has to include how the symbol was reached. Two calls on one line are one
    // reference with two call sites, not one call dropped.
    const same = list.find((r) => r.file === file && r.line === line && r.via === via);
    if (!same) {
      list.push(ref);
      return ref;
    }
    if (call) (same.calls ??= []).push(call);
    return same;
  };

  const listing = listSourceFiles(rootDir, opts.limit);
  if (opts.stats) {
    opts.stats.files = listing.files.length;
    opts.stats.truncated = listing.truncated;
  }
  for (const file of listing.files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(rootDir, file);
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    // Two binding maps, because member reads mean different things:
    // a namespace/CJS binding IS the module's exports; a default binding is a
    // VALUE that happens to have properties.
    const nsBindings = new Map<string, { pkg: string; spec: string; loader?: 'require' }>();
    const defaultBindings = new Map<string, { pkg: string; spec: string }>();
    // Named imports whose properties get read: `import { z } from 'zod'` then
    // `z.string()`. Tracked separately from the other two because whether the
    // member is a claim about the module surface depends on what the parent
    // export turns out to be, and only the scorer can see that.
    const namedBindings = new Map<string, { pkg: string; spec: string; exported: string }>();

    // Identifiers used in VALUE position. A named import used only in type
    // position (`(req: Request) => …`) is erased by TypeScript and never
    // reaches runtime, so it asserts nothing about the runtime surface.
    // `import express, { Request, Response } from 'express'` is correct code;
    // counting Request/Response as runtime symbols reports a miss on it.
    const valueUsed = collectValueIdentifiers(sf);
    // References whose local name is followed to its uses once the file is read.
    const followed = new Map<string, SymbolReference[]>();
    const follow = (local: string, ref: SymbolReference) => {
      const list = followed.get(local);
      if (list) list.push(ref);
      else followed.set(local, [ref]);
    };

    const visit = (node: ts.Node): void => {
      // ── ESM imports ──
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const pkg = packageOfSpecifier(node.moduleSpecifier.text);
        if (pkg) {
          const clause = node.importClause;
          if (!clause) record(pkg, 'default', 'side-effect', node.moduleSpecifier.text, rel, lineOf(node));
          if (clause?.name) {
            record(pkg, 'default', 'default', node.moduleSpecifier.text, rel, lineOf(clause.name));
            defaultBindings.set(clause.name.text, { pkg, spec: node.moduleSpecifier.text });
          }
          if (clause?.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
              nsBindings.set(clause.namedBindings.name.text, { pkg, spec: node.moduleSpecifier.text });
            } else {
              for (const el of clause.namedBindings.elements) {
                const local = el.name.text;
                const exported = el.propertyName?.text ?? local;
                const typeOnly = clause.isTypeOnly || el.isTypeOnly || !valueUsed.has(local);
                const ref = record(
                  pkg,
                  exported,
                  typeOnly ? 'type-only' : 'named',
                  node.moduleSpecifier.text,
                  rel,
                  lineOf(el),
                );
                if (!typeOnly) {
                  follow(local, ref);
                  namedBindings.set(local, {
                    pkg,
                    spec: node.moduleSpecifier.text,
                    exported,
                  });
                }
              }
            }
          }
        }
      }

      // ── re-exports: `export { a, b as c } from 'pkg'` ──
      // In ESM a missing export fails the re-exporting module at load, so each
      // name is a claim on the surface. Uncountable as calls: the uses are in
      // whoever imports this file.
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        const spec = node.moduleSpecifier.text;
        const pkg = packageOfSpecifier(spec);
        if (pkg) {
          for (const el of node.exportClause.elements) {
            const exported = el.propertyName?.text ?? el.name.text;
            const line = lineOf(el);
            if (node.isTypeOnly || el.isTypeOnly) record(pkg, exported, 'type-only', spec, rel, line);
            else record(pkg, exported, 'named', spec, rel, line, undefined, { line, args: null });
          }
        }
      }

      // ── TypeScript `import x = require('pkg')` ──
      if (
        ts.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference) &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        const spec = node.moduleReference.expression.text;
        const pkg = packageOfSpecifier(spec);
        if (pkg) {
          nsBindings.set(node.name.text, { pkg, spec, loader: 'require' });
          const ref = record(pkg, 'default', 'default', spec, rel, lineOf(node.name));
          ref.loader = 'require';
          follow(node.name.text, ref);
        }
      }

      // ── destructuring a namespace binding: `const { a } = ns` ──
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        ts.isObjectBindingPattern(node.name)
      ) {
        const ns = nsBindings.get(node.initializer.text);
        if (ns) {
          for (const el of node.name.elements) {
            const name = el.propertyName ?? el.name;
            if (!ts.isIdentifier(name)) continue;
            const ref = record(ns.pkg, name.text, 'namespace', ns.spec, rel, lineOf(el));
            if (ns.loader) ref.loader = ns.loader;
            if (ts.isIdentifier(el.name)) follow(el.name.text, ref);
          }
        }
      }

      // ── require('pkg'), and `await import('pkg')`, bound to a name ──
      const loaded =
        ts.isVariableDeclaration(node) && node.initializer ? loadedModule(node.initializer) : null;
      if (ts.isVariableDeclaration(node) && loaded) {
        const spec = loaded.spec;
        const viaRequire = loaded.loader === 'require';
        const pkg = packageOfSpecifier(spec);
        if (pkg) {
          if (ts.isIdentifier(node.name)) {
            // In CJS the binding IS module.exports, so member reads are export
            // claims — unless module.exports is a bare value, which the scorer
            // detects from the surface shape rather than guessing here.
            nsBindings.set(node.name.text, { pkg, spec, ...(viaRequire ? { loader: 'require' as const } : {}) });
            const ref = record(pkg, 'default', 'default', spec, rel, lineOf(node.name));
            if (viaRequire) ref.loader = 'require';
            // Followed so a direct call of what `require` returned is visible:
            // that is the use an ESM-only release breaks on every Node version.
            follow(node.name.text, ref);
          } else if (ts.isObjectBindingPattern(node.name)) {
            for (const el of node.name.elements) {
              const name = el.propertyName ?? el.name;
              if (!ts.isIdentifier(name)) continue;
              const ref = record(pkg, name.text, 'destructured', spec, rel, lineOf(el));
              if (viaRequire) ref.loader = 'require';
              if (ts.isIdentifier(el.name)) follow(el.name.text, ref);
            }
          }
        }
      }

      // ── a load whose value is unused: `require('pkg/setup')`, `await import('pkg')` ──
      if (ts.isExpressionStatement(node)) {
        const load = loadedModule(node.expression);
        const pkg = load ? packageOfSpecifier(load.spec) : null;
        if (load && pkg) {
          const ref = record(pkg, 'default', 'side-effect', load.spec, rel, lineOf(node));
          if (load.loader === 'require') ref.loader = 'require';
        }
      }

      // ── a member read straight off a load: `require('pkg').x`, `(await import('pkg')).x` ──
      if (ts.isPropertyAccessExpression(node)) {
        const load = loadedModule(node.expression);
        const pkg = load ? packageOfSpecifier(load.spec) : null;
        if (load && pkg) {
          const ref = record(pkg, node.name.text, 'namespace', load.spec, rel, lineOf(node), undefined, callSiteOf(sf, node));
          if (load.loader === 'require') ref.loader = 'require';
        }
      }

      // ── member reads on a bound namespace/default/named import ──
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const local = node.expression.text;
        const ns = nsBindings.get(local);
        const def = defaultBindings.get(local);
        const named = namedBindings.get(local);
        const call = callSiteOf(sf, node);
        if (ns) {
          const ref = record(ns.pkg, node.name.text, 'namespace', ns.spec, rel, lineOf(node), undefined, call);
          if (ns.loader) ref.loader = ns.loader;
        } else if (def) {
          record(def.pkg, node.name.text, 'default-member', def.spec, rel, lineOf(node), undefined, call);
        } else if (named) {
          record(
            named.pkg,
            node.name.text,
            'named-member',
            named.spec,
            rel,
            lineOf(node),
            named.exported,
            call,
          );
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);

    if (followed.size) {
      const uses = valueUses(sf, new Set(followed.keys()));
      for (const [local, refs] of followed) {
        for (const ref of refs) ref.calls = [...(ref.calls ?? []), ...(uses.get(local) ?? [])];
      }
    }
  }

  return [...byPackage.entries()]
    .map(([pkg, symbols]) => ({ package: pkg, symbols }))
    .sort((a, b) => a.package.localeCompare(b.package));
}
